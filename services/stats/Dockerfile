FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o stats .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/stats /app/stats
COPY --from=builder /app/migrations /app/migrations
ENV PORT=3003
EXPOSE 3003
CMD ["/app/stats"]
