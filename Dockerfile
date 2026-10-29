FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# OAuth 상태 볼륨. 이미지의 소유권이 새 볼륨에 복사되어 node 사용자가 쓸 수 있다
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
