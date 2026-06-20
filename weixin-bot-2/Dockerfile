FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY lib/ ./lib/
COPY simple-agent.js .
COPY system-prompt.txt .
VOLUME ["/app/memory"]
ENV DISABLE_PROXY=true
ENV MEMORY_DIR=/data2
CMD ["node", "simple-agent.js"]
