FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-save typescript && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8787
ENV AGENT_WORKSPACE=/workspace
EXPOSE 8787

CMD ["node", "dist/index.js"]
