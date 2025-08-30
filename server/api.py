#!/usr/bin/env python3
"""
FastAPI Backend for Video PII Analyzer
Provides REST API endpoints for video PII detection
"""

import os
import uuid
import tempfile
import hashlib
from typing import List, Dict, Optional, Any
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
from datetime import datetime
import json
import numpy as np
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import our video analyzer
from video_pii_analyzer import analyze_video_for_pii, detect_pii

# In-memory storage for jobs
jobs_storage = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize in-memory storage and preload AI models
    print("🚀 Starting API with in-memory storage")
    print("🤖 Preloading AI models at startup...")
    
    # Import video_pii_analyzer to trigger model loading
    from video_pii_analyzer import models
    print(f"✅ Loaded {len(models)} PII detection models")
    
    # Preload Whisper model by importing whisper and loading default model
    import whisper
    print("🎤 Loading Whisper model...")
    whisper_model = whisper.load_model("base")
    print("✅ Whisper model loaded successfully!")
    
    # Store models globally for access
    app.state.whisper_model = whisper_model
    app.state.pii_models = models
    
    print("🚀 All AI models preloaded - API ready for requests!")
    
    yield
    
    # Shutdown: Clean up any remaining temp files
    print("🛑 Shutting down API")

app = FastAPI(
    title="Video PII Analyzer API",
    description="API for detecting PII in video content using multiple ML models (In-Memory Storage)",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job management functions
def create_job(job_id: str, filename: str, original_filename: str, status: str = "queued"):
    """Create a new job in memory"""
    jobs_storage[job_id] = {
        "job_id": job_id,
        "status": status,
        "filename": filename,
        "original_filename": original_filename,
        "created_at": datetime.now().isoformat(),
        "completed_at": None,
        "transcript": "",
        "pii_detected": [],
        "pii_segments": [],
        "summary": {},
        "error": None
    }

def update_job_status(job_id: str, status: str, error: str = None):
    """Update job status in memory"""
    if job_id in jobs_storage:
        jobs_storage[job_id]["status"] = status
        if error:
            jobs_storage[job_id]["error"] = error
        if status in ["completed", "failed"]:
            jobs_storage[job_id]["completed_at"] = datetime.now().isoformat()

def update_job_results(job_id: str, transcript: str, pii_detected: list, pii_segments: list, summary: dict):
    """Update job results in memory"""
    if job_id in jobs_storage:
        jobs_storage[job_id].update({
            "status": "completed",
            "transcript": transcript,
            "pii_detected": pii_detected,
            "pii_segments": pii_segments,
            "summary": summary,
            "completed_at": datetime.now().isoformat()
        })

def get_job(job_id: str):
    """Get job from memory"""
    return jobs_storage.get(job_id)

def list_jobs(limit: int = 50, offset: int = 0):
    """List jobs from memory"""
    all_jobs = list(jobs_storage.values())
    # Sort by created_at descending
    all_jobs.sort(key=lambda x: x["created_at"], reverse=True)
    return all_jobs[offset:offset + limit]

def delete_job(job_id: str):
    """Delete job from memory"""
    if job_id in jobs_storage:
        del jobs_storage[job_id]
        return True
    return False

# Response models
class PIIEntity(BaseModel):
    type: str
    text: str
    confidence: float
    start: int
    end: int
    model: str
    ensemble_count: Optional[int] = None
    ensemble_models: Optional[List[str]] = None

class PIISegment(BaseModel):
    timestamp: str
    text: str
    pii: List[PIIEntity]

class AnalysisResult(BaseModel):
    job_id: str
    status: str
    transcript: str
    pii_detected: List[PIIEntity]
    pii_segments: List[PIISegment]
    summary: Dict[str, Any]
    created_at: str
    completed_at: Optional[str] = None

class TextAnalysisRequest(BaseModel):
    text: str

class TextAnalysisResponse(BaseModel):
    pii_detected: List[PIIEntity]
    summary: Dict[str, Any]

def create_job_id() -> str:
    """Generate unique job ID"""
    return str(uuid.uuid4())

def convert_numpy_types(obj):
    """Convert numpy types to Python native types for JSON serialization"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, dict):
        return {key: convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_types(item) for item in obj]
    else:
        return obj

async def analyze_video_async(job_id: str, video_path: str, whisper_model=None):
    """Background task to analyze video"""
    try:
        print(f"Starting analysis for job {job_id}")
        update_job_status(job_id, "processing")
        
        # Run the video analysis using preloaded model
        result = analyze_video_for_pii_api(video_path, whisper_model)
        
        # Convert numpy types to JSON-serializable types
        result = convert_numpy_types(result)
        
        # Update results in memory
        update_job_results(
            job_id=job_id,
            transcript=result["transcript"],
            pii_detected=result["pii_detected"],
            pii_segments=result["pii_segments"],
            summary=result["summary"]
        )
        
        print(f"Analysis completed for job {job_id}")
        
    except Exception as e:
        print(f"Analysis failed for job {job_id}: {e}")
        update_job_status(job_id, "failed", str(e))
    finally:
        # Clean up temp file
        if os.path.exists(video_path):
            os.unlink(video_path)

def analyze_video_for_pii_api(video_path: str, whisper_model=None) -> Dict:
    """Modified version of analyze_video_for_pii that returns structured data"""
    
    # Use preloaded model if provided, otherwise load it
    if whisper_model is None:
        import whisper
        whisper_cache = os.getenv("WHISPER_CACHE", os.path.expanduser("~/.cache/whisper"))
        model = whisper.load_model("base", download_root=whisper_cache)
    else:
        model = whisper_model
    
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
    
    # Transcribe video
    result = model.transcribe(video_path, task="translate")
    full_transcript = result["text"]
    
    # Analyze full transcript for PII
    full_pii = detect_pii(full_transcript)
    
    # Analyze segments
    pii_segments = []
    for segment in result["segments"]:
        start_time = f"{int(segment['start']//60)}:{int(segment['start']%60):02d}"
        end_time = f"{int(segment['end']//60)}:{int(segment['end']%60):02d}"
        segment_text = segment['text'].strip()
        
        segment_pii = detect_pii(segment_text)
        
        if segment_pii:
            pii_segments.append({
                'timestamp': f"{start_time} -> {end_time}",
                'text': segment_text,
                'pii': segment_pii
            })
    
    # Create summary
    pii_by_type = {}
    for pii_item in full_pii:
        pii_type = pii_item['type']
        if pii_type not in pii_by_type:
            pii_by_type[pii_type] = []
        pii_by_type[pii_type].append(pii_item['text'])
    
    summary = {
        "total_pii_items": len(full_pii),
        "segments_with_pii": len(pii_segments),
        "pii_types": {pii_type: len(items) for pii_type, items in pii_by_type.items()},
        "unique_pii_by_type": {pii_type: list(set(items)) for pii_type, items in pii_by_type.items()},
        "has_privacy_concerns": len(full_pii) > 0
    }
    
    return {
        "transcript": full_transcript,
        "pii_detected": full_pii,
        "pii_segments": pii_segments,
        "summary": summary
    }

# API Endpoints

@app.get("/")
async def root():
    return {
        "message": "Video PII Analyzer API",
        "version": "1.0.0",
        "endpoints": {
            "POST /analyze/video": "Upload and analyze video for PII",
            "POST /analyze/text": "Analyze text for PII",
            "GET /jobs/{job_id}": "Get analysis results",
            "GET /health": "Health check"
        }
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

@app.post("/analyze/video")
async def analyze_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    """Upload and analyze video file for PII"""
    
    # Validate file type (accept video and audio files)
    valid_types = ['video/', 'audio/']
    if not any(file.content_type.startswith(vtype) for vtype in valid_types):
        raise HTTPException(status_code=400, detail="File must be a video or audio file")
    
    # Generate job ID
    job_id = create_job_id()
    
    # Save uploaded file to temp directory
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
    try:
        content = await file.read()
        temp_file.write(content)
        temp_file.flush()
        temp_file.close()
        
        # Initialize job in memory
        create_job(
            job_id=job_id,
            filename=temp_file.name,
            original_filename=file.filename,
            status="queued"
        )
        
        # Start background analysis with preloaded model
        background_tasks.add_task(analyze_video_async, job_id, temp_file.name, app.state.whisper_model)
        
        return {
            "job_id": job_id,
            "status": "queued",
            "message": "Video uploaded successfully. Analysis started.",
            "check_status_url": f"/jobs/{job_id}"
        }
        
    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(temp_file.name):
            os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail=f"Error processing video: {e}")

@app.post("/analyze/text", response_model=TextAnalysisResponse)
async def analyze_text(request: TextAnalysisRequest):
    """Analyze text for PII"""
    try:
        pii_detected = detect_pii(request.text)
        
        # Convert numpy types to JSON-serializable types
        pii_detected = convert_numpy_types(pii_detected)
        
        # Create summary
        pii_by_type = {}
        for pii_item in pii_detected:
            pii_type = pii_item['type']
            if pii_type not in pii_by_type:
                pii_by_type[pii_type] = []
            pii_by_type[pii_type].append(pii_item['text'])
        
        summary = {
            "total_pii_items": len(pii_detected),
            "pii_types": {pii_type: len(items) for pii_type, items in pii_by_type.items()},
            "unique_pii_by_type": {pii_type: list(set(items)) for pii_type, items in pii_by_type.items()},
            "has_privacy_concerns": len(pii_detected) > 0
        }
        
        return {
            "pii_detected": pii_detected,
            "summary": summary
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing text: {e}")

@app.get("/jobs/{job_id}")
async def get_analysis_result(job_id: str):
    """Get analysis results by job ID"""
    result = get_job(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return result

@app.get("/jobs")
async def list_jobs_endpoint(limit: int = 50, offset: int = 0):
    """List all analysis jobs"""
    jobs = list_jobs(limit=limit, offset=offset)
    total_jobs = len(jobs_storage)
    return {
        "jobs": jobs,
        "total": total_jobs,
        "limit": limit,
        "offset": offset
    }

@app.delete("/jobs/{job_id}")
async def delete_job_endpoint(job_id: str):
    """Delete analysis job and results"""
    deleted = delete_job(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {"message": f"Job {job_id} deleted successfully"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)