# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
import google.generativeai as genai
import json
import os
import time
from dotenv import load_dotenv

from core.kinematics import PatientSessionAnalyzer

load_dotenv()

app = FastAPI(title="Neural-Kinematic Enterprise API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)
ai_model = genai.GenerativeModel('gemini-1.5-flash')

# Load the dynamic exercise library
with open(os.path.join(os.path.dirname(__file__), "config", "exercises.json"), "r") as f:
    EXERCISE_CONFIG = json.load(f)

class SessionData(BaseModel):
    patient_id: str
    exercise_id: str
    leftMaxROM: int
    rightMaxROM: int
    symmetryScore: int
    repCount: int

class ChatRequest(BaseModel):
    message: str

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.analyzer = PatientSessionAnalyzer(EXERCISE_CONFIG["knee_flexion"])

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()

@app.get("/")
def read_root():
    return {"status": "Research Backend Active", "engine": "SciPy Signal Processing"}

@app.post("/api/save_session")
def save_session(data: SessionData):
    try:
        response = supabase.table("sessions").insert({
            "patient_id": data.patient_id,
            "exercise_id": data.exercise_id,
            "left_max_rom": data.leftMaxROM,
            "right_max_rom": data.rightMaxROM,
            "symmetry_score": data.symmetryScore,
            "rep_count": data.repCount
        }).execute()
        return {"message": "Session data secured", "data": response.data}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/history/{patient_id}")
def get_patient_history(patient_id: str):
    response = supabase.table("sessions").select("*").eq("patient_id", patient_id).order("created_at", desc=True).limit(10).execute()
    return response.data

@app.get("/api/population")
def get_population_data():
    try:
        response = supabase.table("sessions").select("*").order("created_at", desc=True).execute()
        return response.data
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/chat")
def ai_medical_chat(req: ChatRequest):
    try:
        prompt = f"""
        You are the 'Neural-Kinematic AI Assistant', an expert biomechanical and physical therapy AI. 
        A doctor is asking you a question on their clinical dashboard. 
        Keep your answer professional, concise, and focused on joint health, kinematics, or physical rehabilitation.
        Doctor's Query: {req.message}
        """
        response = ai_model.generate_content(prompt)
        return {"reply": response.text}
    except Exception as e:
        return {"reply": f"AI Connection Error: {str(e)}"}

@app.websocket("/ws/movement")
async def websocket_movement_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if payload.get("type") == "skeleton_telemetry":
                landmarks = payload.get("landmarks", [])
                
                if len(landmarks) > 28:
                    timestamp = time.time()
                    
                    # Process kinematics
                    clinical_metrics = manager.analyzer.process_frame(landmarks, timestamp)
                    
                    processed_payload = {
                        "type": "clinical_telemetry",
                        "raw_skeleton": landmarks,
                        "metrics": clinical_metrics
                    }
                    
                    await manager.broadcast(json.dumps(processed_payload))
                    
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"Connection dropped safely: {e}")
        manager.disconnect(websocket)