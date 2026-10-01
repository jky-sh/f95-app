import { Skeleton } from './Skeleton';

function FriendCardSkeleton() {
  return (
    <div className="friend-card-skeleton" aria-hidden="true">
      <Skeleton className="friend-card-skeleton-cover" />
      <div className="friend-card-skeleton-head">
        <Skeleton className="friend-card-skeleton-avatar" />
        <div className="friend-card-skeleton-text">
          <Skeleton className="friend-card-skeleton-name" />
          <Skeleton className="friend-card-skeleton-subtitle" />
        </div>
      </div>
    </div>
  );
}

interface GridProps {
  count?: number;
}

export function FriendCardGridSkeleton({ count = 6 }: GridProps) {
  return (
    <div className="friends-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <FriendCardSkeleton key={i} />
      ))}
    </div>
  );
}
