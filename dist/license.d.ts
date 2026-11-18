export declare const LICENSE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAwWkaGnN3V+2KZgRJVDWJO6pu8xjfpjuM0hCtWUUzepU=\n-----END PUBLIC KEY-----";
export interface LicenseInfo {
    valid: boolean;
    tier: "pro" | "invalid";
    customer?: string;
    expires?: string;
    error?: string;
}
export declare function verifyLicense(key: string): LicenseInfo;
export declare function getLicense(): LicenseInfo;
