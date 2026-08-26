FROM node:24-slim

WORKDIR /app

# Python + pdfplumber for scripts/extract_pdf_fields.py (see scripts/requirements.txt)
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Copy package configuration
COPY package.json ./
COPY scripts/requirements.txt ./scripts/requirements.txt

# Install dependencies
RUN npm install
RUN pip install --break-system-packages -r scripts/requirements.txt

# Copy application source
COPY . .

# Expose Vite dev server port
EXPOSE 3000

# Start Vite dev server accessible from host
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
