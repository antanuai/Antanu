FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# دیتابیس و خروجی‌ها در مسیر قابل‌نوشتن
ENV ANTANU_DB=/tmp/antanu.db
ENV ANTANU_EXPORT_DIR=/tmp/antanu_exports

# روی Render و Hugging Face و بیشتر هاست‌ها پورت از متغیر PORT خوانده می‌شود
# اگر PORT تعریف نشده باشد، پیش‌فرض 8000 (برای اجرای محلی)
ENV PORT=8000
EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
