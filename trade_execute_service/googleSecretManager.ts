import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export class GoogleSecretManager {
    private client: SecretManagerServiceClient;
    private projectId: string;
    private secretName: string;
    private version: string;

    constructor() {
        this.client = new SecretManagerServiceClient();
        this.projectId = process.env.SECRET_MANAGER_PROJECT_ID || '';
        this.secretName = process.env.SECRET_MANAGER_SECRET_NAME || '';
        this.version = process.env.SECRET_MANAGER_VERSION || 'latest';
    }

    async getSecret(): Promise<any> {
        try {
            // Build the secret path
            const secretPath = `projects/${this.projectId}/secrets/${this.secretName}/versions/${this.version}`;
            
            // Access the secret version
            const [response] = await this.client.accessSecretVersion({
                name: secretPath
            });
            
            // Decode and parse the secret payload
            const secretPayload = response.payload?.data?.toString() || '';

            console.log("Successfully accessed secrets from google secret manager!");
            return JSON.parse(secretPayload);
            
        } catch (error) {
            console.error('Error accessing secret:', error);
            throw error;
        }
    }

    validateEnvironment(): void {
        const requiredVars = ['SECRET_MANAGER_PROJECT_ID', 'SECRET_MANAGER_SECRET_NAME'];
        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }
    }
} 