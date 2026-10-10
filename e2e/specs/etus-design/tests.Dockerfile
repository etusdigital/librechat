FROM mcr.microsoft.com/playwright:v1.62.1-noble
ENV CI=true
RUN apt-get update && apt-get install -y --no-install-recommends libnss3-tools && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/e2e
RUN npm init -y >/dev/null && npm install --no-audit --no-fund --save-exact \
      @playwright/test@1.62.1 @axe-core/playwright@4.10.1
