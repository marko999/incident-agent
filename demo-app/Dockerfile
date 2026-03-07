FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js response-config.json ./
EXPOSE 3000
CMD ["node", "--expose-gc", "server.js"]
