# 🕒 Smart Reminder Plugin for Screenpipe

A smart reminder system that analyzes your app usage patterns and provides timely reminders for unfinished tasks or important follow-ups.

## 🌟 Features

- **Real-time App Usage Monitoring**: Tracks your application switches and window changes
- **AI-Powered Analysis**: Uses AI to detect patterns and suggest reminders
- **Smart Notifications**: Intelligently batches notifications to avoid interruption
- **Voice-Based Reminders**: Generate reminders from voice input
- **Flexible AI Provider Support**: Works with:
  - Ollama (recommended with llama2 or llama3)
  - OpenAI-compatible APIs
  - Native Ollama integration

## 🚀 Getting Started

### Prerequisites

- Screenpipe installed and running
- Node.js 18 or higher
- One of the following AI providers:
  - Ollama (recommended)
  - OpenAI API access
  - Other OpenAI-compatible APIs

### Installation

1. Clone this repository:
   ```bash
   git clone [repository-url]
   cd forget_me_not
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## ⚙️ Configuration

### AI Provider Setup

#### Using Ollama (Recommended)

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull the recommended model:
   ```bash
   ollama pull llama3
   ```
3. Start Ollama service

The plugin will automatically connect to Ollama running on `http://localhost:11434`.



## 🎯 Features

### Smart App Tracking

- Monitors app switches and window changes
- Detects brief app interactions
- Identifies interrupted tasks
- Processes voice commands for reminder creation

### AI Analysis

- Analyzes usage patterns every 2 minutes (configurable)
- Detects potential forgotten tasks
- Considers both app names and window titles

### Reminder Management

- Add, complete, and dismiss reminders
- View pending and completed tasks
- Smart batching of notifications

## 🔧 Advanced Configuration

### Analysis Settings

- **Analysis Frequency**: Configure how often AI analyzes your activity (1-10 minutes)
- **Window Title Analysis**: Smart detection of meaningful window titles

### Performance Optimization

- Efficient activity batching
- Smart payload size management
- Automatic cleanup of old data

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

- Built with [Screenpipe](https://screenpipe.com)
- Uses AI models from [Ollama](https://ollama.ai)
- UI components from [shadcn/ui](https://ui.shadcn.com)