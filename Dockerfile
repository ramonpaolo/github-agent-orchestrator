FROM node:20-alpine

WORKDIR /app

# Install git for simple-git
RUN apk add --no-cache git

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source and build
COPY . .
RUN npm run build

# Create logs directory
RUN mkdir -p logs

# Default command
CMD ["node", "dist/cli.js", "run", "--daemon"]
