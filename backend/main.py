from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import qrcode
import barcode
from barcode.writer import ImageWriter
from PIL import Image, ImageDraw, ImageFont
import io
import fitz  # PyMuPDF
import base64
import json
import tempfile
import os

app = FastAPI(title="QR/Barcode Generator API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "https://qr-code-adder.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
MAX_PAGES = 100
DEFAULT_FONT_SIZE = 12

class GenerateRequest(BaseModel):
    start_value: int
    end_value: int
    prefix: str = ""
    include_qr: bool = False
    include_barcode: bool = False
    show_qr_text: bool = False
    show_barcode_text: bool = False
    qr_size: int = 100
    barcode_width: int = 200
    barcode_height: int = 50
    qr_x: int = 100
    qr_y: int = 100
    barcode_x: int = 100
    barcode_y: int = 200
    text_offset_y: int = 10

def generate_qr_code(data: str, size: int) -> Image.Image:
    """Generate QR code image"""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=size // 25,
        border=1,
    )
    qr.add_data(data)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    return img.resize((size, size))

def generate_barcode_image(data: str, width: int, height: int) -> Image.Image:
    """Generate barcode image"""
    try:
        # Use Code128 barcode
        code128 = barcode.get_barcode_class('code128')
        barcode_instance = code128(data, writer=ImageWriter())
        
        # Generate barcode image
        barcode_img = barcode_instance.render({
            'module_width': max(1, width // 100),
            'module_height': height,
            'background': 'white',
            'foreground': 'black',
            'font_size': 8,
            'text_distance': 2,
            'quiet_zone': 2
        })
        
        # Resize to desired dimensions
        return barcode_img.resize((width, height))
    except Exception as e:
        # Fallback: create a simple rectangle with text
        img = Image.new('RGB', (width, height), 'white')
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, width-1, height-1], outline='black', width=2)
        
        # Add text
        try:
            font = ImageFont.load_default()
            text_bbox = draw.textbbox((0, 0), data, font=font)
            text_width = text_bbox[2] - text_bbox[0]
            text_height = text_bbox[3] - text_bbox[1]
            text_x = (width - text_width) // 2
            text_y = (height - text_height) // 2
            draw.text((text_x, text_y), data, fill='black', font=font)
        except:
            pass
            
        return img

def create_page_with_codes(template_img: Image.Image, value: str, config: GenerateRequest) -> Image.Image:
    """Create a page with QR/barcode overlaid on template"""
    page_img = template_img.copy()
    draw = ImageDraw.Draw(page_img)
    
    try:
        font = ImageFont.load_default()
    except:
        font = None
    
    # Add QR code
    if config.include_qr:
        qr_img = generate_qr_code(value, config.qr_size)
        page_img.paste(qr_img, (config.qr_x, config.qr_y))
        
        # Add QR text if requested
        if config.show_qr_text and font:
            text_y = config.qr_y + config.qr_size + config.text_offset_y
            draw.text((config.qr_x, text_y), value, fill='black', font=font)
    
    # Add barcode
    if config.include_barcode:
        barcode_img = generate_barcode_image(value, config.barcode_width, config.barcode_height)
        page_img.paste(barcode_img, (config.barcode_x, config.barcode_y))
        
        # Add barcode text if requested
        if config.show_barcode_text and font:
            text_y = config.barcode_y + config.barcode_height + config.text_offset_y
            draw.text((config.barcode_x, text_y), value, fill='black', font=font)
    
    return page_img

@app.post("/upload-template")
async def upload_template(file: UploadFile = File(...)):
    """Upload template image or PDF"""
    try:
        content = await file.read()
        
        if file.content_type == "application/pdf":
            # Convert PDF first page to image
            pdf_doc = fitz.open(stream=content, filetype="pdf")
            page = pdf_doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x zoom for better quality
            img_data = pix.tobytes("png")
            pdf_doc.close()
            
            template_img = Image.open(io.BytesIO(img_data))
        else:
            # Handle image file
            template_img = Image.open(io.BytesIO(content))
        
        # Convert to RGB if necessary
        if template_img.mode != 'RGB':
            template_img = template_img.convert('RGB')
        
        # Encode image to base64 for frontend
        img_buffer = io.BytesIO()
        template_img.save(img_buffer, format='PNG')
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        
        return {
            "success": True,
            "template_image": f"data:image/png;base64,{img_base64}",
            "dimensions": {
                "width": template_img.width,
                "height": template_img.height
            }
        }
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing template: {str(e)}")

@app.post("/preview")
async def preview_page(
    template_data: str = Form(...),
    config_data: str = Form(...)
):
    """Generate preview of a single page"""
    try:
        config = GenerateRequest(**json.loads(config_data))
        
        # Validate range
        if config.end_value - config.start_value + 1 > MAX_PAGES:
            raise HTTPException(status_code=400, detail=f"Range exceeds maximum of {MAX_PAGES} pages")
        
        if not config.include_qr and not config.include_barcode:
            raise HTTPException(status_code=400, detail="At least one code type must be selected")
        
        # Decode template image
        image_data = base64.b64decode(template_data.split(',')[1])
        template_img = Image.open(io.BytesIO(image_data))
        
        # Generate preview for first value
        first_value = f"{config.prefix}{config.start_value}"
        preview_img = create_page_with_codes(template_img, first_value, config)
        
        # Encode preview image
        img_buffer = io.BytesIO()
        preview_img.save(img_buffer, format='PNG')
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        
        return {
            "success": True,
            "preview_image": f"data:image/png;base64,{img_base64}",
            "total_pages": config.end_value - config.start_value + 1
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error generating preview: {str(e)}")

@app.post("/generate-pdf")
async def generate_pdf(
    template_data: str = Form(...),
    config_data: str = Form(...)
):
    """Generate PDF with all pages"""
    try:
        config = GenerateRequest(**json.loads(config_data))
        
        # Validate range
        if config.end_value - config.start_value + 1 > MAX_PAGES:
            raise HTTPException(status_code=400, detail=f"Range exceeds maximum of {MAX_PAGES} pages")
        
        if not config.include_qr and not config.include_barcode:
            raise HTTPException(status_code=400, detail="At least one code type must be selected")
        
        # Decode template image
        image_data = base64.b64decode(template_data.split(',')[1])
        template_img = Image.open(io.BytesIO(image_data))
        
        # Create PDF
        pdf_buffer = io.BytesIO()
        pages = []
        
        for i in range(config.start_value, config.end_value + 1):
            value = f"{config.prefix}{i}"
            page_img = create_page_with_codes(template_img, value, config)
            pages.append(page_img)
        
        # Save as PDF
        if pages:
            pages[0].save(
                pdf_buffer,
                format='PDF',
                save_all=True,
                append_images=pages[1:] if len(pages) > 1 else []
            )
        
        pdf_buffer.seek(0)
        
        return StreamingResponse(
            io.BytesIO(pdf_buffer.read()),
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=generated_codes.pdf"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error generating PDF: {str(e)}")

@app.get("/config")
async def get_config():
    """Get configuration limits"""
    return {
        "max_pages": MAX_PAGES,
        "supported_formats": ["image/png", "image/jpeg", "image/jpg", "application/pdf"]
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)