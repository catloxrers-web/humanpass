FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN node src/seed.js
EXPOSE 8080
ENV PORT=8080
CMD ["node", "src/server.js"]
