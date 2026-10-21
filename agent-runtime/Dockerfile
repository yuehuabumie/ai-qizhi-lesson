ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}
ARG DEBIAN_MIRROR=deb.debian.org
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PATH=/opt/venv/bin:$PATH
RUN sed -i "s|http://deb.debian.org|http://${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y --no-install-recommends python3 python3-venv python3-pip poppler-utils libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk fonts-liberation chromium curl ca-certificates file tesseract-ocr tesseract-ocr-chi-sim && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir python-docx openpyxl xlrd python-pptx pypdf pillow pillow-heif requests beautifulsoup4 reportlab pdfplumber
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node node_modules/@deepseek-ai/dsh-subprocess-local/scripts/ensure-spawn-helper.mjs
COPY runner.mjs lesson-plugin.mjs runtime-engine.mjs ./
RUN mkdir -p /work /state /tmp && chown -R 1000:1000 /work /state
USER 1000:1000
ENV HOME=/state DSH_HOME=/state/dsh DSH_PERMISSION_MODE=danger-full-access DSH_PRIMARY_RUNTIME="" NODE_USE_ENV_PROXY=1
WORKDIR /work
ENTRYPOINT ["node", "/app/runner.mjs"]
