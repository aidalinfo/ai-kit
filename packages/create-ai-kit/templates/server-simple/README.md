# AI Kit Application

A simple AI Kit server application with a support agent workflow.

## Getting Started

1. Start the development server:

```bash
npm run dev
```

2. The server listens on `http://localhost:3000` (see `server.listen({ port })` in `src/index.ts`).

3. Test the API:

```bash
curl -X POST http://localhost:3000/api/workflows/support-workflow/run \
  -H "Content-Type: application/json" \
  -d '{"inputData": {"message": "Hello, can you help me?"}}'
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

- Plug a real model into `supportAgent` (e.g. `openai("gpt-4o-mini")` or `scaleway("gpt-oss-120b")`)
- Add more agents or expose them under `/api/agents/:id/*`
- Extend the workflow by chaining additional steps with `createStep`
- Configure environment variables (`PORT`, provider keys, Langfuse, etc.)

Learn more at [AI Kit Documentation](https://docs.ai-kit.dev)
