'use client';

import { useAuth } from '@clerk/nextjs';
import { LearnerProfileForm } from '@/components/learner-profile-form';

export default function LearningProfilePage() {
  const { getToken, isLoaded, userId } = useAuth();
  if (!isLoaded) return <p role="status">Loading your learning profile.</p>;
  if (!userId) return null;
  return <LearnerProfileForm key={userId} getToken={getToken} />;
}
