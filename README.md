# 📄 PDF Buddy

A modern, intelligent PDF management tool built with Next.js that helps you interact with your PDF documents seamlessly.

##  Features

-  **Secure Authentication** - Powered by Clerk for robust user authentication
-  **Modern UI** - Built with Next.js 14+ and optimized with Geist font family
-  **Fast Performance** - Server-side rendering and optimized React components
-  **Responsive Design** - Works flawlessly across all devices

## Getting Started

### Prerequisites

Make sure you have one of the following package managers installed:
- Node.js (v18 or higher recommended)
- npm / yarn / pnpm / bun

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ssreyz/pdf-buddy.git
cd pdf-buddy
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
# Create a .env.local file and add your Clerk API keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_publishable_key
CLERK_SECRET_KEY=your_secret_key
```

4. Run the development server:
```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 🛠️ Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) - React framework with server-side rendering
- **Authentication:** [Clerk](https://clerk.com/) - Modern user authentication and management
- **Language:** TypeScript/JavaScript
- **Deployment:** Optimized for [Vercel](https://vercel.com)

## Project Structure

```
pdf-buddy/
├── app/              # Next.js app directory
│   └── page.tsx      # Main page component
├── public/           # Static assets
├── components/       # React components
└── ...
```

## Development

The project uses Next.js App Router. You can start editing by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## Learn More

To learn more about the technologies used in this project:

- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [Clerk Documentation](https://clerk.com/docs) - Authentication and user management
- [Learn Next.js](https://nextjs.org/learn) - Interactive Next.js tutorial

## Deployment

The easiest way to deploy PDF Buddy is using the [Vercel Platform](https://vercel.com/new):

1. Push your code to GitHub
2. Import your repository to Vercel
3. Add your environment variables
4. Deploy!

For more details, check out the [Next.js deployment documentation](https://nextjs.org/docs/deployment).

## Author
**ssreyz**
- GitHub: [@ssreyz](https://github.com/ssreyz)

---

Made with PASSION using Next.js 
