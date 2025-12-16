import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import fs from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

const STORAGE_DIR = './pdf-storage';

// Initialize Gemini for chat responses
const genAI = new GoogleGenerativeAI('API-key');

const queue = new Queue('file-upload-queue', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

const app = express();
app.use(cors());
app.use(express.json());

// Get list of all processed PDFs
async function listProcessedPDFs() {
  try {
    const items = await fs.readdir(STORAGE_DIR, { withFileTypes: true });
    const pdfs = [];
    
    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('error_')) {
        const metadataPath = path.join(STORAGE_DIR, item.name, 'metadata.json');
        try {
          const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
          pdfs.push({
            id: item.name,
            name: metadata.fileName,
            originalName: metadata.originalName || metadata.fileName,
            savedAt: metadata.savedAt,
            fileSize: metadata.fileSize,
            textLength: metadata.textLength || 0,
            chunks: metadata.chunksCount || 0,
            embeddings: metadata.embeddingsGenerated || 0,
            extractionSuccess: metadata.extractionSuccess !== false,
            path: path.join(STORAGE_DIR, item.name),
          });
        } catch (error) {
          console.log(`Skipping ${item.name}: ${error.message}`);
        }
      }
    }
    
    return pdfs.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  } catch (error) {
    console.error('Error listing PDFs:', error);
    return [];
  }
}

// Get text content from a specific PDF
async function getPDFContent(pdfId, maxLength = 4000) {
  try {
    const pdfPath = path.join(STORAGE_DIR, pdfId);
    const textPath = path.join(pdfPath, 'extracted_text.txt');
    
    const text = await fs.readFile(textPath, 'utf-8');
    
    if (text.length > maxLength) {
      return text.substring(0, maxLength) + '... (truncated)';
    }
    
    return text;
  } catch (error) {
    console.error(`Error reading PDF content for ${pdfId}:`, error);
    return null;
  }
}

// Get PDF metadata
async function getPDFMetadata(pdfId) {
  try {
    const pdfPath = path.join(STORAGE_DIR, pdfId);
    const metadataPath = path.join(pdfPath, 'metadata.json');
    
    return JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
  } catch (error) {
    console.error(`Error reading metadata for ${pdfId}:`, error);
    return null;
  }
}

// Search through PDF content using embeddings or text search
async function searchPDFs(query, pdfId = null) {
  const pdfs = await listProcessedPDFs();
  const queryLower = query.toLowerCase();
  const results = [];
  
  const pdfsToSearch = pdfId 
    ? pdfs.filter(pdf => pdf.id === pdfId)
    : pdfs;
  
  for (const pdf of pdfsToSearch) {
    try {
      const content = await getPDFContent(pdf.id, 5000);
      if (!content) continue;
      
      const contentLower = content.toLowerCase();
      
      if (contentLower.includes(queryLower)) {
        const index = contentLower.indexOf(queryLower);
        const contextStart = Math.max(0, index - 150);
        const contextEnd = Math.min(content.length, index + queryLower.length + 150);
        const context = content.substring(contextStart, contextEnd);
        
        results.push({
          pdfId: pdf.id,
          name: pdf.name,
          score: 100,
          context: `...${context}...`,
          pageRef: extractPageNumberFromContext(context),
          matchType: 'text_search',
        });
      }
      
      if (pdf.name.toLowerCase().includes(queryLower)) {
        results.push({
          pdfId: pdf.id,
          name: pdf.name,
          score: 80,
          context: `Filename matches: ${pdf.name}`,
          matchType: 'filename',
        });
      }
      
    } catch (error) {
      console.error(`Error searching PDF ${pdf.id}:`, error);
    }
  }
  
  return results.sort((a, b) => b.score - a.score);
}

function extractPageNumberFromContext(context) {
  const pageMatch = context.match(/\[Page (\d+)\]/);
  return pageMatch ? parseInt(pageMatch[1]) : null;
}

// Use Gemini to answer questions based on PDF content
async function getAIAnswer(question, pdfContent, pdfName) {
  try {
    // Try multiple model names in order
    const modelNames = [
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest', 
      'gemini-pro',
      'gemini-1.0-pro'
    ];
    
    let lastError = null;
    
    for (const modelName of modelNames) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        
        const prompt = `You are a helpful assistant that answers questions based on PDF documents.
        
PDF Document: "${pdfName}"
PDF Content (truncated if long):
${pdfContent}

User Question: "${question}"

Please provide a helpful answer based ONLY on the PDF content above. 
If the information is not in the PDF, say "The PDF doesn't contain information about this."
If the PDF has multiple relevant points, summarize them.
Include page numbers if mentioned in the content (e.g., [Page X]).
Keep your answer concise but informative.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log(`Successfully used model: ${modelName}`);
        return response.text();
        
      } catch (modelError) {
        lastError = modelError;
        console.log(`Model ${modelName} failed, trying next...`);
        continue;
      }
    }
    
    throw lastError || new Error('All models failed');
    
  } catch (error) {
    console.error('Gemini API error:', error.message);
    throw new Error('AI service is temporarily unavailable');
  }
}

// Routes
app.get('/', (req, res) => {
  return res.json({ 
    status: 'PDF Buddy API is running',
    version: '1.0.0',
    endpoints: ['/upload/pdf', '/pdfs', '/chat', '/pdf/:id', '/search', '/recent']
  });
});

// Upload PDF endpoint
app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    console.log(`📤 Upload received: ${req.file.originalname}`);
    
    const job = await queue.add(
      'file-upload-queue',
      {
        filename: req.file.originalname,
        path: req.file.path,
        uploadedAt: new Date().toISOString(),
      }
    );
    
    return res.json({ 
      success: true,
      message: 'PDF uploaded and queued for processing',
      filename: req.file.originalname,
      jobId: job.id,
      status: 'queued',
      note: 'PDF is being processed. You can ask questions about it shortly.'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds 10MB limit' });
      }
    }
    
    return res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
});

// List all processed PDFs
app.get('/pdfs', async (req, res) => {
  try {
    const pdfs = await listProcessedPDFs();
    return res.json({ 
      success: true, 
      count: pdfs.length,
      pdfs: pdfs 
    });
  } catch (error) {
    console.error('Error getting PDFs:', error);
    return res.status(500).json({ error: 'Failed to get PDFs' });
  }
});

// Get specific PDF details
app.get('/pdf/:id', async (req, res) => {
  try {
    const pdfId = req.params.id;
    const pdfPath = path.join(STORAGE_DIR, pdfId);
    
    try {
      await fs.access(pdfPath);
    } catch {
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    const metadata = await getPDFMetadata(pdfId);
    if (!metadata) {
      return res.status(404).json({ error: 'PDF metadata not found' });
    }
    
    const content = await getPDFContent(pdfId, 1000);
    
    return res.json({
      success: true,
      id: pdfId,
      metadata: metadata,
      contentPreview: content,
      files: await fs.readdir(pdfPath),
      hasText: content !== null,
    });
    
  } catch (error) {
    console.error('PDF details error:', error);
    return res.status(500).json({ error: 'Failed to get PDF details' });
  }
});

// Main chat endpoint
app.get('/chat', async (req, res) => {
  try {
    const userQuery = req.query.message;
    const pdfId = req.query.pdfId;
    
    if (!userQuery) {
      return res.status(400).json({ error: 'Message query parameter is required' });
    }
    
    console.log(`Chat request: "${userQuery}" ${pdfId ? `for PDF: ${pdfId}` : ''}`);
    
    const pdfs = await listProcessedPDFs();
    
    if (pdfs.length === 0) {
      return res.json({
        message: "No PDFs found. Please upload a PDF file first.",
        query: userQuery,
        hasPDFs: false,
      });
    }
    
    let targetPdf;
    if (pdfId) {
      targetPdf = pdfs.find(pdf => pdf.id === pdfId);
      if (!targetPdf) {
        return res.json({
          message: `PDF with ID ${pdfId} not found. Available PDFs: ${pdfs.map(p => p.name).join(', ')}`,
          query: userQuery,
          availablePDFs: pdfs.map(p => ({ id: p.id, name: p.name })),
        });
      }
    } else {
      targetPdf = pdfs[0];
    }
    
    const pdfContent = await getPDFContent(targetPdf.id);
    
    if (!pdfContent || pdfContent.length < 50) {
      return res.json({
        message: `Found PDF "${targetPdf.name}" but couldn't read its content properly. Please try re-uploading the PDF.`,
        pdfName: targetPdf.name,
        query: userQuery,
        pdfId: targetPdf.id,
      });
    }
    
    try {
      const aiAnswer = await getAIAnswer(userQuery, pdfContent, targetPdf.name);
      
      return res.json({
        message: aiAnswer,
        pdfName: targetPdf.name,
        pdfId: targetPdf.id,
        query: userQuery,
        source: 'AI Analysis',
        hasAnswer: true,
      });
      
    } catch (aiError) {
      console.log('AI answer failed, falling back to text search:', aiError.message);
      
      const searchResults = await searchPDFs(userQuery, targetPdf.id);
      
      if (searchResults.length > 0) {
        const bestMatch = searchResults[0];
        
        return res.json({
          message: `Based on "${targetPdf.name}":\n\n${bestMatch.context}\n\n(Found via text search${bestMatch.pageRef ? `, Page ${bestMatch.pageRef}` : ''})`,
          pdfName: targetPdf.name,
          pdfId: targetPdf.id,
          query: userQuery,
          source: 'Text Search',
          hasAnswer: true,
          matches: searchResults.length,
        });
      }
      
      return res.json({
        message: `I searched through "${targetPdf.name}" but couldn't find information about "${userQuery}". Try asking a different question or check if the PDF contains that information.`,
        pdfName: targetPdf.name,
        pdfId: targetPdf.id,
        query: userQuery,
        source: 'No Match Found',
        hasAnswer: false,
      });
    }
    
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ 
      error: 'Chat processing failed',
      details: error.message,
    });
  }
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'PDF Buddy API'
  });
});

// Test Gemini API connection and list models
app.get('/test-gemini', async (req, res) => {
  try {
    const modelNames = [
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro-latest',
      'gemini-pro',
      'gemini-1.0-pro'
    ];
    
    const results = [];
    
    for (const modelName of modelNames) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Say "Hello"');
        const response = await result.response;
        results.push({
          model: modelName,
          status: 'working',
          response: response.text()
        });
        break; // Stop after first working model
      } catch (error) {
        results.push({
          model: modelName,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    return res.json({
      success: results.some(r => r.status === 'working'),
      results: results
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Test failed',
      details: error.message
    });
  }
});

// Search endpoint (text-based)
app.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const pdfId = req.query.pdfId;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const results = await searchPDFs(query, pdfId);
    
    return res.json({
      success: true,
      query: query,
      results: results,
      count: results.length,
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
});

// Get recent uploads
app.get('/recent', async (req, res) => {
  try {
    const pdfs = await listProcessedPDFs();
    const recent = pdfs.slice(0, 5);
    
    return res.json({
      success: true,
      recent: recent.map(pdf => ({
        id: pdf.id,
        name: pdf.name,
        uploaded: pdf.savedAt,
        size: (pdf.fileSize / 1024 / 1024).toFixed(2) + ' MB',
      })),
      total: pdfs.length,
    });
  } catch (error) {
    console.error('Recent error:', error);
    return res.status(500).json({ error: 'Failed to get recent uploads' });
  }
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log('\n PDF Buddy Backend Started');
  console.log(` Port: ${PORT}`);
  console.log(' Storage:', path.resolve(STORAGE_DIR));
  console.log(' Endpoints:');
  console.log('  - POST /upload/pdf');
  console.log('  - GET  /pdfs');
  console.log('  - GET  /pdf/:id');
  console.log('  - GET  /chat?message=...');
  console.log('  - GET  /search?q=...');
  console.log('  - GET  /recent');
  console.log('  - GET  /health');
});

export default app;