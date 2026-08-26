# Azure DevOps Deployment Notifier

A browser extension for Chrome and Edge that monitors Azure DevOps build pipelines and sends desktop notifications for important events.

## Features

- Monitor any Azure DevOps build pipeline
- Select specific stages to monitor — ignore stages you don't care about
- Notified when a stage succeeds, fails, or needs approval
- Click a notification to jump straight to the build
- Works without continuously watching Azure DevOps

## How It Works

1. Open a pipeline build in Azure DevOps.
2. Click the extension icon — it detects the pipeline automatically.
3. Select which stages you want to monitor (tap a stage to toggle it).
4. Click **Start Monitoring**.
5. The extension checks for updates every 30 seconds.
6. You'll get a desktop notification when a monitored stage completes or needs approval.
7. Click the notification to jump straight to the build.

## Privacy

All data is stored locally in the browser. No information is sent to external services.

## Future Ideas

- Teams notifications
- Slack integration
- Monitoring multiple pipelines simultaneously
- Custom notification rules
- Build dashboard
