FROM node:22-alpine

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 3979

CMD ["node", "dist/index.js"]
