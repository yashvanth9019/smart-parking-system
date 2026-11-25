# Step-by-Step Guide to Run SmartPark RTD in VS Code

## 1. Open Project in VS Code
1. Launch **Visual Studio Code**.
2. Click **File -> Open Folder...** and select `c:\Users\cheaten\Desktop\nv`.
3. Recommended VS Code extensions:
   - **Python** (`ms-python.python`)
   - **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`)
   - **MongoDB for VS Code** (`mongodb.mongodb-vscode`)

---

## 2. Ensure MongoDB Is Running
Open a VS Code terminal (`Ctrl + ~`) and verify MongoDB is running on port `27017`:
- If installed as a Windows Service, it runs automatically on `mongodb://localhost:27017`.
- Or start a local instance manually:
```powershell
mkdir C:\data\db -Force
"C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath C:\data\db --port 27017
```

---

## 3. Set Up Environment Files
Verify `.env` exists in the root folder and `frontend/.env.local` exists in `frontend/` (both are pre-configured; `.env.example` and `frontend/.env.local.example` are provided as templates).

---

## 4. Install Python Packages, Train ML Models & Seed Database
In VS Code Terminal 1:
```powershell
python -m pip install -r backend/requirements.txt
python machine_learning/train.py
python -m database.seed --reset
```

---

## 5. Run the FastAPI Backend
In VS Code Terminal 1:
```powershell
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```
Open `http://localhost:8000/docs` in your browser to inspect Swagger API docs.

---

## 6. Run the Next.js Frontend
Open a second VS Code Terminal (`+` icon in Terminal panel):
```powershell
cd frontend
npm install
npm run dev
```
Open `http://localhost:3005` in your browser!

---

## 7. Run Live IoT Sensor Simulation (Demo Mode)
You can demonstrate real-time updates in two ways:
1. **From the Browser**: Sign in to Admin (`http://localhost:3005/admin/login` with `admin@smartpark.io` / `Admin@123`) -> go to **IoT & ML Analytics** -> click **Start Auto IoT Sim (4s)**, or go to **Locations & Slots** and click any slot card.
2. **From VS Code Terminal 3**:
```powershell
python iot_simulation/simulator.py --interval 4
```
Watch the User Live Dashboard (`http://localhost:3005`) update Green/Red slot statuses instantly without refreshing!

---

## 8. Run Automated Backend Tests
```powershell
python -m pytest backend/tests/test_api.py -v
```

