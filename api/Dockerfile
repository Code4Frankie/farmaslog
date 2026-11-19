FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p /app/uploads && chown node:node /app/uploads
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
