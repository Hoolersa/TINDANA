# Small, production-ready Node image
FROM node:20-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Cloud Run injects PORT; our server already reads process.env.PORT
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server/wsServer.js"]
