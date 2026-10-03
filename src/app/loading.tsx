export default function Loading() {
  return (
    <div className="loading-view" role="status">
      <span className="sr-only">جارٍ تحميل الصفحة</span>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-subtitle" />
      <div className="course-grid">
        {[1, 2, 3].map((item) => (
          <div key={item} className="skeleton skeleton-card" />
        ))}
      </div>
    </div>
  );
}
