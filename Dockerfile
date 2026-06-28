# Orrery Systems Modeler — runs anywhere Docker runs (Windows, Linux, Mac, cloud).
FROM node:26-alpine

WORKDIR /app

# install server deps first for better layer caching
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev

# app source
COPY server ./server
COPY public ./public

# project library lives in a volume so data survives container restarts
ENV DATA_DIR=/data
ENV PORT=8137
VOLUME ["/data"]
EXPOSE 8137

CMD ["node", "server/server.js"]
