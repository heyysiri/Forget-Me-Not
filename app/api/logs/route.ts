import { NextResponse } from 'next/server';

// In-memory storage for logs (will reset on server restart)
let memoryLogs: any[] = [];

/**
 * POST handler to save a new app switch log.
 */
export async function POST(request: Request) {
  try {
    // Add more robust JSON parsing
    let newLog;
    try {
      const text = await request.text();
      if (!text || text.trim() === '') {
        return NextResponse.json(
          { error: 'Empty request body' },
          { status: 400 }
        );
      }
      
      newLog = JSON.parse(text);
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Basic validation of the log data
    if (
      !newLog ||
      typeof newLog.timestamp !== 'number' ||
      typeof newLog.app !== 'string'
    ) {
      console.error('Invalid log data structure:', newLog);
      return NextResponse.json(
        { error: 'Invalid log data. Expecting { timestamp: number, app: string, windowName?: string }.' },
        { status: 400 }
      );
    }

    // Ensure windowName is always a string
    if (newLog.windowName === undefined || newLog.windowName === null) {
      newLog.windowName = '';
    }

    // Add to in-memory logs
    memoryLogs.push(newLog);
    
    // Keep only last 1000 logs to prevent memory usage from growing too large
    if (memoryLogs.length > 1000) {
      memoryLogs = memoryLogs.slice(-1000);
    }
    
    // console.log('New app switch logged:', {
    //   app: newLog.app,
    //   windowName: newLog.windowName,
    //   timestamp: new Date(newLog.timestamp).toISOString()
    // });
    
    return NextResponse.json({ message: 'Log saved successfully' });
  } catch (error) {
    console.error('Error in POST /api/logs:', error);
    return NextResponse.json({ error: 'Failed to save log' }, { status: 500 });
  }
}

/**
 * GET handler to retrieve all logs.
 * Optional query parameters:
 * - limit: number of logs to return (default: all)
 * - since: timestamp to filter logs from (default: all)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit') as string, 10) : undefined;
    const since = searchParams.get('since') ? parseInt(searchParams.get('since') as string, 10) : undefined;
    
    let logs = [...memoryLogs]; // Create a copy to avoid mutation issues
    
    // Filter by timestamp if 'since' is provided
    if (since) {
      logs = logs.filter(log => log.timestamp >= since);
    }
    
    // Limit results if specified
    if (limit && limit > 0) {
      logs = logs.slice(-limit);
    }
    
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error in GET /api/logs:', error);
    return NextResponse.json({ error: 'Failed to retrieve logs' }, { status: 500 });
  }
}

/**
 * DELETE handler to clear all logs.
 */
export async function DELETE() {
  try {
    memoryLogs = [];
    return NextResponse.json({ message: 'All logs cleared successfully' });
  } catch (error) {
    console.error('Error in DELETE /api/logs:', error);
    return NextResponse.json({ error: 'Failed to clear logs' }, { status: 500 });
  }
}