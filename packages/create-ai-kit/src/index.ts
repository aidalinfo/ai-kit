#!/usr/bin/env node

import { program } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ProjectConfig {
  projectName: string;
  template: string;
  packageManager: 'npm' | 'yarn' | 'pnpm';
}

program
  .name('create-ai-kit')
  .description('Initialize a new ai-kit project')
  .argument('[project-name]', 'name of the project')
  .action(async (projectName?: string) => {
    console.log(chalk.bold.cyan('\n🤖 Welcome to AI Kit project creator!\n'));

    const config: ProjectConfig = {
      projectName: '',
      template: 'server-simple',
      packageManager: 'npm',
    };

    // Ask for project name if not provided
    if (!projectName) {
      const response = await prompts({
        type: 'text',
        name: 'projectName',
        message: 'What is your project name?',
        initial: 'my-ai-kit-app',
        validate: (value) => {
          if (!value) return 'Project name is required';
          if (!/^[a-z0-9-_]+$/.test(value)) {
            return 'Project name can only contain lowercase letters, numbers, hyphens and underscores';
          }
          return true;
        },
      });

      if (!response.projectName) {
        console.log(chalk.red('\n❌ Project creation cancelled\n'));
        process.exit(0);
      }

      config.projectName = response.projectName;
    } else {
      config.projectName = projectName;
    }

    // Detect package manager
    const detectedPM = detectPackageManager();

    const pmResponse = await prompts({
      type: 'select',
      name: 'packageManager',
      message: 'Which package manager do you want to use?',
      choices: [
        { title: 'npm', value: 'npm' },
        { title: 'yarn', value: 'yarn' },
        { title: 'pnpm', value: 'pnpm' },
      ],
      initial: detectedPM === 'npm' ? 0 : detectedPM === 'yarn' ? 1 : 2,
    });

    if (!pmResponse.packageManager) {
      console.log(chalk.red('\n❌ Project creation cancelled\n'));
      process.exit(0);
    }

    config.packageManager = pmResponse.packageManager;

    // Create project
    await createProject(config);
  });

program.parse();

function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return 'pnpm';
  } catch {
    try {
      execSync('yarn --version', { stdio: 'ignore' });
      return 'yarn';
    } catch {
      return 'npm';
    }
  }
}

async function createProject(config: ProjectConfig) {
  const { projectName, template, packageManager } = config;
  const projectPath = path.join(process.cwd(), projectName);

  // Check if directory already exists
  if (fs.existsSync(projectPath)) {
    console.log(chalk.red(`\n❌ Directory "${projectName}" already exists!\n`));
    process.exit(1);
  }

  const spinner = ora('Creating project...').start();

  try {
    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true });

    // Copy template
    const templatePath = path.join(__dirname, '..', 'templates', template);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template "${template}" not found`);
    }

    fs.copySync(templatePath, projectPath);

    // Update package.json with project name
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = fs.readJsonSync(packageJsonPath);
    packageJson.name = projectName;
    fs.writeJsonSync(packageJsonPath, packageJson, { spaces: 2 });

    spinner.succeed('Project created successfully!');

    // Install dependencies
    const installSpinner = ora('Installing dependencies...').start();

    try {
      const installCommand =
        packageManager === 'npm' ? 'npm install' :
        packageManager === 'yarn' ? 'yarn install' :
        'pnpm install';

      execSync(installCommand, {
        cwd: projectPath,
        stdio: 'ignore'
      });

      installSpinner.succeed('Dependencies installed!');
    } catch (error) {
      installSpinner.fail('Failed to install dependencies');
      console.log(chalk.yellow('\nYou can install them manually by running:'));
      console.log(chalk.cyan(`  cd ${projectName}`));
      console.log(chalk.cyan(`  ${packageManager} install\n`));
    }

    // Success message
    console.log(chalk.green.bold('\n✨ Project created successfully!\n'));
    console.log(chalk.bold('Next steps:\n'));
    console.log(chalk.cyan(`  cd ${projectName}`));
    console.log(chalk.cyan(`  ${packageManager === 'npm' ? 'npm run' : packageManager} dev`));
    console.log();

  } catch (error) {
    spinner.fail('Failed to create project');
    console.error(chalk.red('\n❌ Error:'), error instanceof Error ? error.message : error);

    // Cleanup on error
    if (fs.existsSync(projectPath)) {
      fs.removeSync(projectPath);
    }

    process.exit(1);
  }
}
