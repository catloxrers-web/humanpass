FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --build-from-source
COPY . .
RUN node src/seed.js
EXPOSE 8080
ENV PORT=8080
CMD ["node", "src/server.js"]
