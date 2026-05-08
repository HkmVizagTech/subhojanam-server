FROM node:18-slim

# Install dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_OPTIONS="--max-old-space-size=1024" \
    CHROME_CRASHPAD_HANDLER_DISABLED=1 \
    DISABLE_CRASH_REPORTING=1 \
    NO_CRASH_REPORTER=1

# Create non-root user
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /workspace/receipts \
    && chown -R pptruser:pptruser /workspace

WORKDIR /workspace

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Fix sandbox permissions
RUN chmod 4755 /usr/bin/chromium-sandbox || true

USER pptruser

EXPOSE 8080

CMD ["node", "index.js"]
