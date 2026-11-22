# Codespaces P0 steps (beginner, Android Chrome)
1. Chrome -> github.com -> your private STORVA repo -> menu (3 dots) -> tick "Desktop site".
2. Green "<> Code" button -> "Codespaces" tab -> "Create codespace on main". Wait 1-3 min.
   Next time: github.com/codespaces -> tap your STORVA codespace.
3. Terminal: menu (top left) -> Terminal -> New Terminal.
4. node --version   (need v20 or higher)
   npm --version
5. npm install   (then keep package-lock.json)
6. npm run test:unit   (want: fail 0)
7. docker compose -f docker-compose.test.yml up -d
   MONGODB_URI=mongodb://127.0.0.1:27018/storva_test npm run test:integration   (want: fail 0, skipped 0)
8. Browser tests, then Razorpay Test Mode (use TEST keys only).
Do not start Module 7 until all pass and you authorize it. Send results one step at a time.
