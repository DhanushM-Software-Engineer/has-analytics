FROM python:3.12-slim
WORKDIR /app

COPY analytics-api/requirements.txt analytics-api/
RUN pip install --no-cache-dir -r analytics-api/requirements.txt

COPY analytics-api/main.py analytics-api/
COPY dashboard.html .
COPY dashboard_app.js .

WORKDIR /app/analytics-api
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
