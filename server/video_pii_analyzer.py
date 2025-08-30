import whisper
import sys
import os
import librosa
import numpy as np
from scipy.signal import butter, filtfilt
import tempfile
import soundfile as sf
import re
import torch
from transformers import AutoTokenizer, AutoModelForTokenClassification, pipeline

# Initialize multiple PII detection models for ensemble approach
print("🤖 Loading multiple PII detection models...")

models = {}

# Model 1: Stanford AIMI deidentifier
print("   Loading Stanford AIMI...")
models['stanford_aimi'] = pipeline(
    "token-classification",
    model="StanfordAIMI/stanford-deidentifier-base",
    tokenizer="StanfordAIMI/stanford-deidentifier-base",
    aggregation_strategy="simple"
)

# Model 2: BERT NER for general entities
print("   Loading BERT NER...")
models['bert_ner'] = pipeline(
    "token-classification",
    model="dslim/bert-base-NER",
    tokenizer="dslim/bert-base-NER",
    aggregation_strategy="simple"
)

# Model 3: Isotonic DeBERTa AI4Privacy
print("   Loading Isotonic DeBERTa...")
models['isotonic_deberta'] = pipeline(
    "token-classification",
    model="Isotonic/deberta-v3-base_finetuned_ai4privacy_v2",
    tokenizer="Isotonic/deberta-v3-base_finetuned_ai4privacy_v2",
    aggregation_strategy="simple"
)

print("✅ All PII detection models loaded successfully!")

def detect_phone_numbers_in_stream(text):
    """Enhanced phone number detection for continuous number streams"""
    phone_patterns = [
        # Singapore mobile numbers (8 digits starting with 8 or 9)
        r'\b[89]\d{7}\b',
        # Singapore landline numbers (8 digits starting with 6)
        r'\b6\d{7}\b',
        # International formats
        r'\+65\s?[689]\d{7}',
        r'\(\+65\)\s?[689]\d{7}',
        # US numbers (10 digits)
        r'\b\d{10}\b',
        # Generic 8-digit patterns in continuous streams
        r'\b\d{8}\b',
        # 11-digit patterns (like +65 format without +)
        r'\b65[689]\d{7}\b'
    ]
    
    phone_matches = []
    for pattern in phone_patterns:
        matches = re.finditer(pattern, text)
        for match in matches:
            # Additional validation for Singapore numbers
            phone_num = match.group()
            is_valid_sg = False
            
            # Check if it's a valid Singapore number
            if len(phone_num) == 8:
                if phone_num[0] in ['6', '8', '9']:
                    is_valid_sg = True
            elif len(phone_num) == 10 and phone_num.startswith('65'):
                if phone_num[2] in ['6', '8', '9']:
                    is_valid_sg = True
            elif len(phone_num) == 10:  # US format
                is_valid_sg = True
            
            if is_valid_sg:
                phone_matches.append({
                    "type": "PHONE_NUMBER",
                    "text": phone_num,
                    "confidence": 0.9,
                    "start": match.start(),
                    "end": match.end()
                })
    
    return phone_matches

def detect_pii(text):
    """Enhanced PII detection using ensemble of multiple models"""
    all_pii_found = []
    
    # Run detection with each model
    for model_name, model_pipeline in models.items():
        try:
            results = model_pipeline(text)
            
            # Get detected PII with confidence scores
            for entity in results:
                all_pii_found.append({
                    "type": entity['entity_group'],
                    "text": entity['word'],
                    "confidence": entity['score'],
                    "start": entity['start'],
                    "end": entity['end'],
                    "model": model_name
                })
        except Exception as e:
            print(f"   Warning: {model_name} failed: {e}")
            continue
    
    # Add enhanced phone number detection for continuous streams
    phone_matches = detect_phone_numbers_in_stream(text)
    for phone_match in phone_matches:
        phone_match["model"] = "regex_phone"
        all_pii_found.append(phone_match)
    
    # Merge overlapping detections and vote on confidence
    merged_pii = merge_overlapping_entities(all_pii_found)
    
    # Sort by start position
    merged_pii.sort(key=lambda x: x["start"])
    
    return merged_pii

def merge_overlapping_entities(entities):
    """Merge overlapping PII entities from different models"""
    if not entities:
        return []
    
    # Sort by start position
    entities.sort(key=lambda x: x["start"])
    merged = []
    
    i = 0
    while i < len(entities):
        current = entities[i]
        overlapping = [current]
        
        # Find all overlapping entities
        j = i + 1
        while j < len(entities):
            next_entity = entities[j]
            # Check if entities overlap
            if (next_entity["start"] < current["end"] and 
                next_entity["end"] > current["start"]):
                overlapping.append(next_entity)
                j += 1
            else:
                break
        
        # Merge overlapping entities
        if len(overlapping) == 1:
            merged.append(current)
        else:
            # Choose the entity with highest confidence
            best_entity = max(overlapping, key=lambda x: x["confidence"])
            
            # Add ensemble information
            best_entity["ensemble_models"] = [e["model"] for e in overlapping]
            best_entity["ensemble_count"] = len(overlapping)
            best_entity["ensemble_avg_confidence"] = sum(e["confidence"] for e in overlapping) / len(overlapping)
            
            merged.append(best_entity)
        
        i = j if j > i + 1 else i + 1
    
    return merged

def separate_vocals(audio_path):
    """
    Extract vocals from audio using center channel extraction and filtering.
    This removes most background music while preserving speech.
    """
    print("🎵 Separating vocals from background music...")
    
    # Load audio file
    y, sr = librosa.load(audio_path, sr=None, mono=False)
    
    # If stereo, extract center channel (vocals are usually centered)
    if len(y.shape) > 1:
        # Center channel extraction: left + right - (left - right)
        center = (y[0] + y[1]) / 2
        sides = (y[0] - y[1]) / 2
        vocals = center - 0.3 * sides  # Reduce side information
    else:
        vocals = y
    
    # Apply high-pass filter to remove low-frequency music
    def high_pass_filter(data, sr, cutoff=80):
        nyquist = sr / 2
        normal_cutoff = cutoff / nyquist
        b, a = butter(5, normal_cutoff, btype='high', analog=False)
        return filtfilt(b, a, data)
    
    # Apply band-pass filter for speech frequencies (80Hz - 8kHz)
    def band_pass_filter(data, sr, low=80, high=8000):
        nyquist = sr / 2
        low_normal = low / nyquist
        high_normal = high / nyquist
        b, a = butter(5, [low_normal, high_normal], btype='band', analog=False)
        return filtfilt(b, a, data)
    
    # Apply filters
    vocals_filtered = band_pass_filter(vocals, sr)
    
    # Normalize audio
    vocals_filtered = vocals_filtered / np.max(np.abs(vocals_filtered))
    
    # Save to temporary file
    temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    sf.write(temp_file.name, vocals_filtered, sr)
    temp_file.close()
    
    print(f"✅ Vocals extracted to temporary file")
    return temp_file.name

def analyze_video_for_pii(video_path):
    """Transcribe video and analyze for PII content"""
    # Load the Whisper model
    print("🤖 Loading Whisper model...")
    model = whisper.load_model("medium")
    
    # Check if file exists
    if not os.path.exists(video_path):
        print(f"❌ Error: File '{video_path}' not found!")
        return
    
    print(f"🎬 Analyzing video for PII: {video_path}")
    print("This may take a few moments...")
    
    # Use original file (vocal separation commented out for now)
    audio_file = video_path
    # audio_file = separate_vocals(video_path)
    
    try:
        # Transcribe the audio to English
        result = model.transcribe(
            audio_file, 
            task="translate"
        )
        
        # Get full transcript
        full_transcript = result["text"]
        
        # Analyze full transcript for PII
        print("\n" + "="*60)
        print("🔍 PII ANALYSIS - FULL TRANSCRIPT:")
        print("="*60)
        print(f"Transcript: {full_transcript}")
        print("-" * 40)
        
        full_pii = detect_pii(full_transcript)
        if full_pii:
            print("⚠️  PII DETECTED IN FULL TRANSCRIPT:")
            for pii_item in full_pii:
                ensemble_info = ""
                if 'ensemble_count' in pii_item and pii_item['ensemble_count'] > 1:
                    ensemble_info = f" [detected by {pii_item['ensemble_count']} models]"
                print(f"  • {pii_item['type']}: '{pii_item['text']}' (confidence: {pii_item['confidence']:.2f}){ensemble_info}")
        else:
            print("✅ No PII detected in full transcript")
        
        # Analyze segments for PII
        print("\n" + "="*60)
        print("🔍 PII ANALYSIS - BY SEGMENTS:")
        print("="*60)
        
        pii_segments = []
        for segment in result["segments"]:
            start_time = f"{int(segment['start']//60)}:{int(segment['start']%60):02d}"
            end_time = f"{int(segment['end']//60)}:{int(segment['end']%60):02d}"
            segment_text = segment['text'].strip()
            
            # Detect PII in this segment
            segment_pii = detect_pii(segment_text)
            
            print(f"[{start_time} -> {end_time}] {segment_text}")
            
            if segment_pii:
                print("  ⚠️  PII FOUND:")
                for pii_item in segment_pii:
                    ensemble_info = ""
                    if 'ensemble_count' in pii_item and pii_item['ensemble_count'] > 1:
                        ensemble_info = f" [detected by {pii_item['ensemble_count']} models]"
                    print(f"    • {pii_item['type']}: '{pii_item['text']}' (confidence: {pii_item['confidence']:.2f}){ensemble_info}")
                pii_segments.append({
                    'timestamp': f"{start_time} -> {end_time}",
                    'text': segment_text,
                    'pii': segment_pii
                })
            else:
                print("  ✅ No PII detected")
            print("-" * 40)
        
        # Summary
        print("\n" + "="*60)
        print("📊 PII ANALYSIS SUMMARY:")
        print("="*60)
        
        if full_pii or pii_segments:
            print("⚠️  PRIVACY CONCERNS DETECTED!")
            print(f"Total PII items found: {len(full_pii)}")
            print(f"Segments with PII: {len(pii_segments)}")
            
            # Group PII by type
            pii_by_type = {}
            for pii_item in full_pii:
                pii_type = pii_item['type']
                if pii_type not in pii_by_type:
                    pii_by_type[pii_type] = []
                pii_by_type[pii_type].append(pii_item['text'])
            
            print("\nPII Types Detected:")
            for pii_type, items in pii_by_type.items():
                print(f"  • {pii_type}: {len(items)} item(s)")
                for item in set(items):  # Remove duplicates
                    print(f"    - '{item}'")
        else:
            print("✅ No PII detected in the video")
            print("The video appears to be safe for sharing without privacy concerns.")
            
    finally:
        # Clean up temporary file if vocal separation was used
        if audio_file != video_path:
            try:
                os.unlink(audio_file)
                print("🗑️  Cleaned up temporary vocal file")
            except:
                pass

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python video_pii_analyzer.py <path_to_video_file>")
        print("Example: python video_pii_analyzer.py sample.mp4")
        print("\nThis script will:")
        print("- Transcribe the audio from your video")
        print("- Analyze the transcript for PII (Personal Identifiable Information)")
        print("- Report any privacy concerns found")
        sys.exit(1)
    
    video_file = sys.argv[1]
    analyze_video_for_pii(video_file)