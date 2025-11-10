# @ai_kit/create-ai-kit

CLI to quickly bootstrap new AI Kit projects.

## Usage

### Using npx (Recommended)

```bash
npx @ai_kit/create-ai-kit my-app
```

### Interactive Mode

Run without arguments for an interactive setup:

```bash
npx @ai_kit/create-ai-kit
```

You'll be prompted to:
- Choose your project name
- Select your preferred package manager (npm, yarn, or pnpm)

## What's Included

The CLI will create a new project with:

- **TypeScript configuration** - Ready to use with strict mode enabled
- **AI Kit dependencies** - `@ai_kit/core` and `@ai_kit/server` pre-installed
- **Sample code** - A working server with an agent and workflow
- **Development scripts** - Hot reload with `tsx watch`
- **Build configuration** - Production-ready TypeScript build

## Project Structure

```
my-app/
├── src/
│   └── index.ts          # Main server file with agent setup
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Available Scripts

Once created, navigate to your project and run:

```bash
cd my-app

# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Templates

Currently available template:
- **server-simple** - A minimal server setup with one agent and workflow

More templates coming soon!

## Requirements

- Node.js 18 or higher
- npm, yarn, or pnpm

## Example

```bash
# Create a new project
npx @ai_kit/create-ai-kit my-ai-app

# Navigate to project
cd my-ai-app

# Start development
npm run dev
```

Your server will be running at `http://localhost:3000`

Test it:

```bash
curl -X POST http://localhost:3000/api/workflow \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'
```

## License

MIT
