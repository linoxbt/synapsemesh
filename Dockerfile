FROM node:18-alpine

WORKDIR /app

# Copy dependency files
COPY package.json ./

# Install dependencies
RUN npm install ethers dotenv

# Copy application files
COPY swarm.js ./
COPY specialized_agents.json ./

# We will inject the .env at runtime via the 0G Compute deployer or secret manager,
# but we can provide a dummy one if needed.
# For security, never bake private keys into the Docker image directly.

# Run the swarm commander
CMD ["node", "swarm.js"]
