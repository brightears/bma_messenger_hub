# Render MCP Setup Guide

## Installation Complete ✅

The Render MCP has been successfully installed globally and configured for your project.

## Configuration for Claude Code

### Option 1: Global Configuration (Recommended)

Add this to your Claude Code settings (`~/.config/Code/User/settings.json` or via Settings UI):

```json
{
  "mcp.servers": {
    "render": {
      "command": "npx",
      "args": ["@niyogi/render-mcp"],
      "env": {
        "RENDER_API_KEY": "rnd_rHJGnHtBpJQej50ey9jRbGOU0FdN"
      }
    }
  }
}
```

### Option 2: Using the MCP Config File

The `mcp-config.json` file has been created in this project with your Render API configuration.

### Option 3: Manual Configuration in Claude Code

1. Open Claude Code Settings (Cmd+, on Mac)
2. Search for "MCP"
3. Find "MCP: Servers"
4. Click "Edit in settings.json"
5. Add the Render configuration above

## Available Render MCP Commands

Once configured, you can use these commands in Claude Code:

- **Deploy Service**: "Deploy my app to Render"
- **Check Status**: "What's the status of my Render services?"
- **View Logs**: "Show me the logs for my Render service"
- **Manage Environment**: "Update environment variables on Render"
- **Scale Service**: "Scale my Render service"

## Testing the Connection

To test if the MCP is working:

1. Restart Claude Code after adding the configuration
2. Type: "Check my Render services"
3. Claude should be able to list your Render services

## Environment Variables

Your Render API key has been added to:
- `.env` file: `RENDER_API_KEY=rnd_rHJGnHtBpJQej50ey9jRbGOU0FdN`
- MCP config: Available in `mcp-config.json`

## Security Notes

- Never commit the `mcp-config.json` file to version control (already in .gitignore)
- The Render API key provides full access to your Render account
- Rotate the key periodically for security

## Troubleshooting

If the MCP isn't working:

1. Check that the package is installed:
   ```bash
   npm list -g @niyogi/render-mcp
   ```

2. Verify the API key is correct:
   ```bash
   curl -H "Authorization: Bearer rnd_rHJGnHtBpJQej50ey9jRbGOU0FdN" \
        https://api.render.com/v1/services
   ```

3. Restart Claude Code after configuration changes

4. Check Claude Code Developer Tools for MCP errors

## Next Steps

1. Create a Render Web Service for your app
2. Use the render.yaml blueprint for automatic setup
3. Deploy using: "Deploy bma-messenger-hub to Render"