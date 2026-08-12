FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY scripts ./scripts

ENV PORT=3000
EXPOSE 3000

# Non gira come root.
USER node

CMD ["node", "server/index.js"]
