FROM golang:1.21-alpine AS go-builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /snowball .

FROM mcr.microsoft.com/playwright:v1.41.0-jammy

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=go-builder /snowball .
COPY migrations ./migrations
COPY browser ./browser

WORKDIR /app/browser
RUN npm install
RUN npx playwright install chromium

WORKDIR /app

EXPOSE 3006

CMD ["./snowball"]
