import json
import random

locations = [
    "Block A, Floor 1, Room 102", "Block A, Floor 2, Room 205", 
    "Block B, Floor 3, Room 304", "Block B, Floor 4, Room 412",
    "Central Mess Hall B", "Library Block, Floor 2", "CS Department Lab 2"
]

complaint_templates = [
    # Electrical
    ("bhai {location} ka fan regulator spark kar raha hai jaldi electrician bhejo", "ELECTRICAL", "Ceiling Fan Regulator Sparking", "HIGH", 2, "Dispatch Electrician"),
    ("tube light flickering in {location} since morning", "ELECTRICAL", "Tube Light Flickering", "MEDIUM", 6, "Replace Tube Light"),
    ("power socket dead in {location}, cannot charge laptop for project", "ELECTRICAL", "Power Socket Failure", "MEDIUM", 4, "Repair Power Outlet"),
    
    # Plumbing / Water
    ("water leakage from washroom ceiling near {location}", "PLUMBING", "Ceiling Water Leakage", "HIGH", 3, "Inspect Plumbing Pipe"),
    ("drinking water cooler on {location} giving warm water and tastes metallic", "WATER_COOLER", "Water Cooler Malfunction", "MEDIUM", 8, "Service Water Filter & Chiller"),
    ("tap broken in bathroom near {location}", "PLUMBING", "Broken Water Tap", "LOW", 12, "Replace Tap Valve"),
    
    # Mess & Food Quality
    ("mess food today in {location} has too much salt and paneer is uncooked", "MESS_FEEDBACK", "Substandard Food Quality", "MEDIUM", 4, "Notify Chief Mess Steward"),
    ("insect found in salad at {location} dinner service", "MESS_HYGIENE", "Mess Hygiene Inspection Required", "CRITICAL", 1, "Immediate Sanitation Audit"),
    
    # Gate Pass Requests
    ("need gate pass urgent for pharmacy in city market till 9pm for fever medicine", "GATE_PASS", "Medical Emergency Outing", "HIGH", 1, "Approve Emergency Gate Pass"),
    ("request outing pass to purchase project hardware components from market", "GATE_PASS", "Academic Hardware Purchase", "MEDIUM", 4, "Approve Standard Day Pass")
]

dataset = []

system_prompt = (
    "You are CampusDebug OS AI, an offline-first college operations parser. "
    "Convert informal student requests or complaints into structured JSON tickets."
)

for i in range(160):
    tmpl, cat, title, urgency, sla, action = random.choice(complaint_templates)
    loc = random.choice(locations)
    text = tmpl.format(location=loc)
    
    output_json = {
        "category": cat,
        "title": title,
        "location": loc,
        "urgency": urgency,
        "sla_hours": sla,
        "action_required": action,
        "confidence_score": round(random.uniform(0.92, 0.99), 2)
    }
    
    record = {
        "instruction": system_prompt,
        "input": text,
        "output": json.dumps(output_json, ensure_ascii=False)
    }
    dataset.append(record)

with open("campus_ai_dataset.jsonl", "w", encoding="utf-8") as f:
    for entry in dataset:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

print(f"Successfully generated {len(dataset)} dataset entries in 'campus_ai_dataset.jsonl'!")