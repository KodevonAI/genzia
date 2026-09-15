import { SignIn } from "@clerk/nextjs";

/**
 * Catch-all route Clerk's `<SignIn/>` component requires for its internal
 * (verification code, etc.) steps. `path`/`forceRedirectUrl` are built from
 * the actual request locale so the redirect after login lands on
 * `/[locale]/dashboard`, never a hardcoded locale.
 */
export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <SignIn
        path={`/${locale}/sign-in`}
        routing="path"
        forceRedirectUrl={`/${locale}/dashboard`}
        signUpUrl={`/${locale}/sign-up`}
      />
    </div>
  );
}
