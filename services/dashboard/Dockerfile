FROM node:20-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ARG VITE_STATS_API_URL
ENV VITE_STATS_API_URL=$VITE_STATS_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
