import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

if (!process.env.TOKEN_SECRET) {
  process.env.TOKEN_SECRET = "test-token-secret";
}
