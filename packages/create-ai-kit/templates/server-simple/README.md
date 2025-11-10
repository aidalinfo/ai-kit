# AI Kit Application

A simple AI Kit server application with a support agent workflow.

## Getting Started

1. Start the development server:

```bash
npm run dev
```

2. The server will be running at `http://localhost:3000`

3. Test the API:

```bash
curl -X POST http://localhost:3000/api/workflow \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, can you help me?"}'
```

## Project Structure

```
src/
  index.ts       # Main server file with agent and workflow setup
```

## Available Scripts

- `npm run dev` - Start the development server with hot reload
- `npm run build` - Build the project for production
- `npm start` - Run the production build

## Next Steps

- Add more agents to your workflow
- Customize the agent instructions
- Add environment variables for configuration
- Implement custom endpoints

Learn more at [AI Kit Documentation](https://docs.ai-kit.dev)
