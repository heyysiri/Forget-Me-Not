import { pipe } from "@screenpipe/js";
import { NextResponse } from "next/server";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    console.log("API: Getting Screenpipe settings");
    
    // First check if Screenpipe is running with a safer method
    try {
      // pipe.getStatus() doesn't exist, use settings.getAll() as a check
      const settings = await pipe.settings.getAll();
      console.log("API: Screenpipe connection successful");
    } catch (error) {
      console.error("API: Failed to connect to Screenpipe. Is the service running?", error);
      return NextResponse.json(
        { 
          error: "Failed to connect to Screenpipe. Is the service running?",
          // Provide fallback settings
          aiProviderType: 'ollama',
          aiModel: 'llama2',
          aiUrl: 'http://localhost:11434/api/generate'
        }, 
        { status: 503 } // Service unavailable
      );
    }
    
    const settings = await pipe.settings.getAll();
    
    // Only return the needed settings and strip any sensitive data
    const sanitizedSettings = {
      aiProviderType: settings.aiProviderType || 'ollama',
      aiModel: settings.aiModel || 'llama2',
      aiUrl: settings.aiUrl || 'http://localhost:11434/api/generate',
      // Don't include the full API key, just a hint if it exists
      openaiApiKeyExists: !!settings.openaiApiKey
    };
    
    return NextResponse.json(sanitizedSettings);
  } catch (error) {
    console.error("API: Failed to get settings:", error);
    return NextResponse.json(
      { 
        error: "Failed to get settings",
        // Provide fallback settings
        aiProviderType: 'ollama',
        aiModel: 'llama2',
        aiUrl: 'http://localhost:11434/api/generate'
      }, 
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const settingsManager = pipe.settings;
    if (!settingsManager) {
      throw new Error("settingsManager not found");
    }

    const body = await request.json();
    const { key, value, isPartialUpdate, reset, namespace } = body;

    if (reset) {
      if (namespace) {
        if (key) {
          await settingsManager.setCustomSetting(namespace, key, undefined);
        } else {
          await settingsManager.updateNamespaceSettings(namespace, {});
        }
      } else {
        if (key) {
          await settingsManager.resetKey(key);
        } else {
          await settingsManager.reset();
        }
      }
      return NextResponse.json({ success: true });
    }

    if (namespace) {
      if (isPartialUpdate) {
        const currentSettings =
          (await settingsManager.getNamespaceSettings(namespace)) || {};
        await settingsManager.updateNamespaceSettings(namespace, {
          ...currentSettings,
          ...value,
        });
      } else {
        await settingsManager.setCustomSetting(namespace, key, value);
      }
    } else if (isPartialUpdate) {
      const serializedSettings = JSON.parse(JSON.stringify(value));
      await settingsManager.update(serializedSettings);
    } else {
      const serializedValue = JSON.parse(JSON.stringify(value));
      await settingsManager.set(key, serializedValue);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("failed to update settings:", error);
    return NextResponse.json(
      { error: "failed to update settings" },
      { status: 500 }
    );
  }
}

