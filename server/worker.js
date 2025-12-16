import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Worker } from 'bullmq';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.mjs';

const STORAGE_DIR = './pdf-storage';

// Initialize Gemini
const genAI = new GoogleGenerativeAI('API_key_here');

async function extractPDFText(fileBuffer, fileName) {
  try {
    console.log(`Starting text extraction for: ${fileName}`);
    
    // Fixed: Convert Buffer to Uint8Array for PDF.js
    const loadingTask = pdfjsLib.getDocument({ 
      data: new Uint8Array(fileBuffer) 
    });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    const totalPages = pdf.numPages;
    
    console.log(`PDF has ${totalPages} pages`);
    
    // Extract text from each page
    for (let i = 1; i <= totalPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += `[Page ${i}]\n${pageText}\n\n`;
        
        if (i % 5 === 0 || i === totalPages) {
          console.log(`  Extracted page ${i}/${totalPages}`);
        }
      } catch (pageError) {
        console.log(` Error extracting page ${i}:`, pageError.message);
        fullText += `[Page ${i}] - Extraction failed\n\n`;
      }
    }
    
    const text = fullText.trim();
    
    if (text.length === 0) {
      throw new Error('No text could be extracted from PDF');
    }
    
    console.log(`Extracted ${text.length} characters from PDF`);
    return text;
    
  } catch (error) {
    console.error(` PDF extraction failed for ${fileName}:`, error.message);
    
    // Fallback: Try to extract any readable text from buffer
    try {
      const bufferString = fileBuffer.toString('utf-8', 0, Math.min(10000, fileBuffer.length));
      const lines = bufferString.split('\n')
        .filter(line => line.trim().length > 0 && !line.includes('%PDF') && !line.includes('xref'))
        .slice(0, 50)
        .join('\n');
      
      if (lines.length > 100) {
        console.log(`  Using fallback text extraction (${lines.length} chars)`);
        return `[PDF Extraction Failed - Using Fallback]\n${lines}`;
      }
    } catch (fallbackError) {
      console.log('  Fallback extraction also failed');
    }
    
    throw new Error(`PDF text extraction failed: ${error.message}`);
  }
}

// Helper function to extract page references from chunk
function extractPageReference(chunk) {
  const pageMatch = chunk.match(/\[Page (\d+)\]/);
  return pageMatch ? parseInt(pageMatch[1]) : null;
}

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    console.log(`\n Job ${job.id}: Starting processing`);
    
    // Get file path
    const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;
    let filePath = data.file || data.path;
    filePath = filePath.replace(/\\/g, '/');
    const fileName = path.basename(filePath);
    
    console.log(`Processing file: ${fileName}`);
    
    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Read PDF file
      console.log(`Reading PDF file...`);
      const fileBuffer = await fs.readFile(filePath);
      
      // Extract text from PDF
      console.log(`Extracting text from PDF...`);
      let extractedText;
      let extractionSuccess = true;
      
      try {
        extractedText = await extractPDFText(fileBuffer, fileName);
      } catch (extractionError) {
        console.log(`Using placeholder due to extraction error: ${extractionError.message}`);
        extractedText = `PDF: ${fileName}\n\nNote: Text extraction partially failed. Some PDFs with complex formatting or images may not extract all text.\n\nTry asking questions about the PDF content anyway.`;
        extractionSuccess = false;
      }
      
      // Split into chunks (max 1000 chars per chunk)
      const chunkSize = 1000;
      const overlap = 200;
      const chunks = [];
      
      if (extractedText.length > chunkSize) {
        for (let i = 0; i < extractedText.length; i += chunkSize - overlap) {
          const chunk = extractedText.substring(i, i + chunkSize);
          if (chunk.trim().length > 0) {
            chunks.push(chunk);
          }
          if (chunks.length >= 50) {
            break;
          }
        }
      } else {
        chunks.push(extractedText);
      }
      
      console.log(`Split into ${chunks.length} text chunks`);
      
      // Generate embeddings with Gemini
      console.log(`Generating embeddings...`);
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      
      const chunksWithEmbeddings = [];
      let successfulEmbeddings = 0;
      
      // Process first 10 chunks max to avoid API limits
      const chunksToProcess = Math.min(chunks.length, 10);
      
      for (let i = 0; i < chunksToProcess; i++) {
        try {
          const chunk = chunks[i];
          // Skip very short chunks
          if (chunk.length < 20) continue;
          
          const result = await model.embedContent(chunk);
          const embedding = result.embedding.values;
          
          chunksWithEmbeddings.push({
            id: `${job.id}_${i}`,
            content: chunk,
            embedding: embedding,
            chunkIndex: i,
            pageRef: extractPageReference(chunk),
          });
          
          successfulEmbeddings++;
          
          if (successfulEmbeddings % 3 === 0) {
            console.log(`  Generated ${successfulEmbeddings}/${chunksToProcess} embeddings`);
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.log(`  Error embedding chunk ${i}:`, error.message);
        }
      }
      
      // Save everything
      const timestamp = Date.now();
      const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 100);
      const savePath = path.join(STORAGE_DIR, `${safeName}_${job.id}_${timestamp}`);
      await fs.mkdir(savePath, { recursive: true });
      
      console.log(`Saving files to: ${savePath}`);
      
      // Save files
      await fs.writeFile(path.join(savePath, 'original.pdf'), fileBuffer);
      await fs.writeFile(path.join(savePath, 'extracted_text.txt'), extractedText);
      await fs.writeFile(path.join(savePath, 'chunks.json'), JSON.stringify(chunks, null, 2));
      
      if (chunksWithEmbeddings.length > 0) {
        await fs.writeFile(
          path.join(savePath, 'chunks_with_embeddings.json'), 
          JSON.stringify(chunksWithEmbeddings, null, 2)
        );
      }
      
      // Save metadata
      const metadata = {
        jobId: job.id,
        fileName: fileName,
        originalName: data.filename || fileName,
        savedAt: new Date().toISOString(),
        fileSize: fileBuffer.length,
        textLength: extractedText.length,
        chunksCount: chunks.length,
        embeddingsGenerated: chunksWithEmbeddings.length,
        extractionSuccess: extractionSuccess,
        filePath: filePath,
        storagePath: savePath,
        processingTime: new Date().toISOString(),
      };
      
      await fs.writeFile(path.join(savePath, 'metadata.json'), JSON.stringify(metadata, null, 2));
      
      console.log(` Successfully processed: ${fileName}`);
      console.log(`   Text: ${extractedText.length} characters`);
      console.log(`   Chunks: ${chunks.length}`);
      console.log(`   Embeddings: ${chunksWithEmbeddings.length}`);
      console.log(`   Saved to: ${savePath}`);
      
      return {
        success: true,
        fileName: fileName,
        pdfId: path.basename(savePath),
        textLength: extractedText.length,
        chunks: chunks.length,
        embeddings: chunksWithEmbeddings.length,
        path: savePath,
        extractionSuccess: extractionSuccess,
      };
      
    } catch (error) {
      console.log(`Error processing ${fileName}:`, error.message);
      console.log(error.stack);
      
      // Try to save at least the file even if processing failed
      try {
        const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const errorPath = path.join(STORAGE_DIR, `error_${safeName}_${Date.now()}`);
        await fs.mkdir(errorPath, { recursive: true });
        
        const errorMeta = {
          jobId: job.id,
          fileName: fileName,
          error: error.message,
          savedAt: new Date().toISOString(),
          stack: error.stack,
        };
        
        await fs.writeFile(path.join(errorPath, 'error.json'), JSON.stringify(errorMeta, null, 2));
      } catch (saveError) {
        console.log('Could not save error details:', saveError.message);
      }
      
      throw error;
    }
  },
  {
    concurrency: 1,
    connection: { 
      host: 'localhost', 
      port: 6379 
    },
  }
);

// Event handlers
worker.on('completed', (job, result) => {
  console.log(`\nJob completed: ${result.fileName}`);
  console.log(`   Stats: ${result.textLength} chars, ${result.chunks} chunks, ${result.embeddings} embeddings`);
  console.log(`   PDF ID: ${result.pdfId}`);
});

worker.on('failed', (job, err) => {
  console.log(`\nJob failed: ${job?.id} - ${err.message}`);
  if (err.stack) {
    console.log(`   Stack: ${err.stack.split('\n')[1]}`);
  }
});

worker.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});

// Create storage dir and start
fs.mkdir(STORAGE_DIR, { recursive: true }).then(() => {
  console.log('\nPDF Processing Worker Started');
  console.log(`Storage directory: ${path.resolve(STORAGE_DIR)}`);
  console.log('Ready to process PDF uploads\n');
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n Received SIGINT. Closing worker...');
  await worker.close();
  console.log('Worker closed. Goodbye!');
  process.exit(0);
});

export { worker };