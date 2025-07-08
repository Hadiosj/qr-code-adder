import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE_URL = 'http://localhost:8000';

function App() {
  const [template, setTemplate] = useState(null);
  const [templateDimensions, setTemplateDimensions] = useState(null);
  const [config, setConfig] = useState({
    start_value: 1,
    end_value: 10,
    prefix: '',
    include_qr: true,
    include_barcode: false,
    show_qr_text: false,
    show_barcode_text: false,
    qr_size: 100,
    barcode_width: 200,
    barcode_height: 50,
    qr_x: 100,
    qr_y: 100,
    barcode_x: 100,
    barcode_y: 200,
    text_offset_y: 10
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [maxPages, setMaxPages] = useState(100);
  const [totalPages, setTotalPages] = useState(0);
  
  const fileInputRef = useRef(null);
  const previewTimeoutRef = useRef(null);

  useEffect(() => {
    // Fetch configuration
    fetch(`${API_BASE_URL}/config`)
      .then(res => res.json())
      .then(data => setMaxPages(data.max_pages))
      .catch(err => console.error('Error fetching config:', err));
  }, []);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE_URL}/upload-template`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload template');
      }

      const data = await response.json();
      setTemplate(data.template_image);
      setTemplateDimensions(data.dimensions);
      setPreview(null);
    } catch (err) {
      setError(`Error uploading template: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const generatePreview = useCallback(async () => {
    if (!template) {
      setPreview(null);
      return;
    }

    if (!config.include_qr && !config.include_barcode) {
      setError('Please select at least one code type');
      setPreview(null);
      return;
    }

    const range = config.end_value - config.start_value + 1;
    if (range > maxPages) {
      setError(`Range exceeds maximum of ${maxPages} pages`);
      setPreview(null);
      return;
    }

    setPreviewLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('template_data', template);
    formData.append('config_data', JSON.stringify(config));

    try {
      const response = await fetch(`${API_BASE_URL}/preview`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate preview');
      }

      const data = await response.json();
      setPreview(data.preview_image);
      setTotalPages(data.total_pages);
    } catch (err) {
      setError(`Error generating preview: ${err.message}`);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [template, config, maxPages]);

  // Auto-generate preview when template or config changes
  useEffect(() => {
    if (template) {
      // Clear existing timeout
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
      
      // Set new timeout to debounce rapid changes
      previewTimeoutRef.current = setTimeout(() => {
        generatePreview();
      }, 500); // 500ms debounce
    }
    
    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [template, config, generatePreview]);

  const downloadPDF = async () => {
    if (!template) {
      setError('Please upload a template first');
      return;
    }

    if (!config.include_qr && !config.include_barcode) {
      setError('Please select at least one code type');
      return;
    }

    const range = config.end_value - config.start_value + 1;
    if (range > maxPages) {
      setError(`Range exceeds maximum of ${maxPages} pages`);
      return;
    }

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('template_data', template);
    formData.append('config_data', JSON.stringify(config));

    try {
      const response = await fetch(`${API_BASE_URL}/generate-pdf`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'generated_codes.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setError(`Error generating PDF: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const resetTemplate = () => {
    setTemplate(null);
    setTemplateDimensions(null);
    setPreview(null);
    setError('');
    setTotalPages(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>QR/Barcode Generator</h1>
        <p>Upload a template and generate PDFs with QR codes and barcodes</p>
      </header>

      <div className="container">
        {/* Template Upload Section */}
        <div className="section">
          <h2>1. Upload Template</h2>
          <div className="upload-area">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*,.pdf"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button onClick={() => fileInputRef.current?.click()}>
              Choose Template File
            </button>
            {template && (
              <div className="template-preview">
                <img src={template} alt="Template" style={{ maxWidth: '200px', maxHeight: '200px' }} />
                <p>Dimensions: {templateDimensions?.width} x {templateDimensions?.height}</p>
                <button onClick={resetTemplate} className="reset-btn">Reset Template</button>
              </div>
            )}
          </div>
        </div>

        {/* Configuration Section */}
        <div className="section">
          <h2>2. Configure Codes</h2>
          
          <div className="config-grid">
            <div className="config-group">
              <h3>Range Settings</h3>
              <div className="input-group">
                <label>Start Value:</label>
                <input
                  type="number"
                  value={config.start_value}
                  onChange={(e) => handleConfigChange('start_value', parseInt(e.target.value))}
                  min="1"
                />
              </div>
              <div className="input-group">
                <label>End Value:</label>
                <input
                  type="number"
                  value={config.end_value}
                  onChange={(e) => handleConfigChange('end_value', parseInt(e.target.value))}
                  min="1"
                />
              </div>
              <div className="input-group">
                <label>Prefix:</label>
                <input
                  type="text"
                  value={config.prefix}
                  onChange={(e) => handleConfigChange('prefix', e.target.value)}
                  placeholder="e.g., PT"
                />
              </div>
              <p className="info">Total pages: {config.end_value - config.start_value + 1} (Max: {maxPages})</p>
            </div>

            <div className="config-group">
              <h3>Code Types</h3>
              <div className="checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={config.include_qr}
                    onChange={(e) => handleConfigChange('include_qr', e.target.checked)}
                  />
                  Include QR Code
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.include_barcode}
                    onChange={(e) => handleConfigChange('include_barcode', e.target.checked)}
                  />
                  Include Barcode
                </label>
              </div>
            </div>

            <div className="config-group">
              <h3>Text Display</h3>
              <div className="checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={config.show_qr_text}
                    onChange={(e) => handleConfigChange('show_qr_text', e.target.checked)}
                    disabled={!config.include_qr}
                  />
                  Show QR Code Text
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.show_barcode_text}
                    onChange={(e) => handleConfigChange('show_barcode_text', e.target.checked)}
                    disabled={!config.include_barcode}
                  />
                  Show Barcode Text
                </label>
              </div>
            </div>
          </div>

          {/* QR Code Settings */}
          {config.include_qr && (
            <div className="config-group">
              <h3>QR Code Settings</h3>
              <div className="input-row">
                <div className="input-group">
                  <label>Size:</label>
                  <input
                    type="number"
                    value={config.qr_size}
                    onChange={(e) => handleConfigChange('qr_size', parseInt(e.target.value))}
                    min="50"
                    max="300"
                  />
                </div>
                <div className="input-group">
                  <label>X Position:</label>
                  <input
                    type="number"
                    value={config.qr_x}
                    onChange={(e) => handleConfigChange('qr_x', parseInt(e.target.value))}
                    min="0"
                  />
                </div>
                <div className="input-group">
                  <label>Y Position:</label>
                  <input
                    type="number"
                    value={config.qr_y}
                    onChange={(e) => handleConfigChange('qr_y', parseInt(e.target.value))}
                    min="0"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Barcode Settings */}
          {config.include_barcode && (
            <div className="config-group">
              <h3>Barcode Settings</h3>
              <div className="input-row">
                <div className="input-group">
                  <label>Width:</label>
                  <input
                    type="number"
                    value={config.barcode_width}
                    onChange={(e) => handleConfigChange('barcode_width', parseInt(e.target.value))}
                    min="100"
                    max="400"
                  />
                </div>
                <div className="input-group">
                  <label>Height:</label>
                  <input
                    type="number"
                    value={config.barcode_height}
                    onChange={(e) => handleConfigChange('barcode_height', parseInt(e.target.value))}
                    min="30"
                    max="100"
                  />
                </div>
                <div className="input-group">
                  <label>X Position:</label>
                  <input
                    type="number"
                    value={config.barcode_x}
                    onChange={(e) => handleConfigChange('barcode_x', parseInt(e.target.value))}
                    min="0"
                  />
                </div>
                <div className="input-group">
                  <label>Y Position:</label>
                  <input
                    type="number"
                    value={config.barcode_y}
                    onChange={(e) => handleConfigChange('barcode_y', parseInt(e.target.value))}
                    min="0"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Preview Section */}
        <div className="section">
          <h2>3. Live Preview</h2>
          <div className="preview-status">
            {previewLoading && (
              <div className="loading-indicator">
                <span>Updating preview...</span>
              </div>
            )}
            {totalPages > 0 && (
              <p className="info">Preview shows first page of {totalPages} total pages</p>
            )}
            {!template && (
              <p className="info">Upload a template to see live preview</p>
            )}
          </div>
          {preview && (
            <div className="preview-container">
              <div className={`preview-wrapper ${previewLoading ? 'loading' : ''}`}>
                <img src={preview} alt="Live Preview" className="preview-image" />
                {previewLoading && <div className="preview-overlay">Updating...</div>}
              </div>
            </div>
          )}
        </div>

        {/* Generate Section */}
        <div className="section">
          <h2>4. Generate PDF</h2>
          <button 
            onClick={downloadPDF} 
            disabled={loading || !template || !preview || previewLoading}
            className="download-btn"
          >
            {loading ? 'Generating PDF...' : 'Download PDF'}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;