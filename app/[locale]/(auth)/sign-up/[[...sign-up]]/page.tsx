import { SignUp } from "@clerk/nextjs";

/**
 * Catch-all route Clerk's `<SignUp/>` component requires for its internal
 * (verification code, etc.) steps. `path`/`forceRedirectUrl` are built from
 * the actual request locale so the redirect after account creation lands on
 * `/[locale]/onboarding`, never a hardcoded locale.
 */
export default async function SignUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <SignUp
        path={`/${locale}/sign-up`}
        routing="path"
        forceRedirectUrl={`/${locale}/onboarding`}
      />
    </div>
  );
}
