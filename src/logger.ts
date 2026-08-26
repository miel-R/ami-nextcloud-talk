const ts = () => new Date().toISOString();

function line(icon: string, msg: string, ...args: any[]): void {
    console.log(`${icon} [${ts()}] ${msg}`, ...args);
}

export const logger = {
    info: (msg: string, ...args: any[]) => line('ℹ️ ', msg, ...args),
    success: (msg: string, ...args: any[]) => line('✅', msg, ...args),
    warn: (msg: string, ...args: any[]) => line('⚠️ ', msg, ...args),
    error: (msg: string, ...args: any[]) => console.error(`❌ [${ts()}] ${msg}`, ...args)
};
