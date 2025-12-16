'use client'
import { Upload, FileText, X } from 'lucide-react';
import * as React from 'react'
import { useState } from 'react';

const FileUpload: React.FC = () => { 
  const [isClicked, setIsClicked] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const handleUploadButtonClick = () => {
    // Click animation
    setIsClicked(true);
    
    // Create file input
    const element = document.createElement('input');
    element.setAttribute('type', 'file');
    element.setAttribute('accept', '.pdf,application/pdf'); // Only accept PDF files
    element.click();
    
    element.addEventListener('change', async (event) => {
      if (element.files && element.files.length > 0) {
        const file = element.files.item(0);
        if (file && file.type === 'application/pdf') {
          setUploadedFile(file);
          setUploadedFileName(file.name);
          
          // Create local URL for preview
          const localUrl = URL.createObjectURL(file);
          setPdfUrl(localUrl);
          
          setIsUploading(true);
          
          const formData = new FormData();
          formData.append('pdf', file);
          
          try {
            const response = await fetch('http://localhost:8000/upload/pdf', {
              method: 'POST',
              body: formData
            });
            
            if (response.ok) {
              console.log('File Uploaded Successfully');
              // You could also get the server URL if the PDF is stored on server
              // const data = await response.json();
              // setPdfUrl(data.pdfUrl); // If server returns a URL
            } else {
              console.error('Upload failed');
              // Handle error - maybe show error message
            }
          } catch (error) {
            console.error('Upload error:', error);
          } finally {
            setIsUploading(false);
          }
        } else {
          alert('Please select a PDF file');
        }
      }
    });

    // Reset animation after 150ms
    setTimeout(() => setIsClicked(false), 150);
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
    setUploadedFileName('');
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl); // Clean up the object URL
    }
    setPdfUrl(null);
  };

  return (
    <div className="w-full space-y-4">
      {/* Upload Button */}
      <div 
        className={`
          bg-violet-700 text-white shadow-2xl 
          flex justify-center items-center p-8 
          rounded-lg w-full h-32 cursor-pointer 
          hover:bg-violet-800 transition-all duration-150
          transform
          ${isClicked ? 'scale-95 bg-violet-900 shadow-lg' : 'scale-100 hover:scale-105'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        onClick={handleUploadButtonClick}
      > 
        {isUploading ? (
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mr-3"></div>
            <span className='ml-3 text-lg font-medium'>Uploading...</span>
          </div>
        ) : (
          <>
            <Upload 
              size={32} 
              className={`transition-transform duration-150 ${
                isClicked ? 'scale-90' : 'scale-100'
              }`}
            />
            <span className='ml-3 text-lg font-medium'>Upload PDF</span>
          </>
        )}
      </div>

      {/* Uploaded File Info */}
      {uploadedFile && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <FileText className="text-violet-600 mr-2" size={24} />
              <div>
                <h3 className="font-medium text-gray-900">{uploadedFileName}</h3>
                <p className="text-sm text-gray-500">
                  {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB • PDF
                </p>
              </div>
            </div>
            <button
              onClick={handleRemoveFile}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="Remove file"
            >
              <X size={20} className="text-gray-500" />
            </button>
          </div>
          
          {/* PDF Preview */}
          {pdfUrl && (
            <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                <h4 className="text-sm font-medium text-gray-700">PDF Preview</h4>
              </div>
              <div className="h-96 overflow-hidden">
                <iframe 
                  src={pdfUrl}
                  className="w-full h-full"
                  title="PDF Preview"
                  style={{ border: 'none' }}
                />
              </div>
              <div className="bg-gray-50 px-3 py-2 border-t border-gray-200">
                <a 
                  href={pdfUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-violet-600 hover:text-violet-800 font-medium flex items-center"
                >
                  <FileText size={16} className="mr-1" />
                  Open in new tab
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      {!uploadedFile && (
        <div className="text-center text-gray-500 text-sm">
          <p>Upload a PDF file to view its contents here</p>
          <p className="mt-1">Maximum file size: 10MB</p>
        </div>
      )}
    </div>
  );
};

export default FileUpload;