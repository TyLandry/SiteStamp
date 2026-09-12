import LogoutButton from "../components/LogoutButton";
import EmployerHoursView from "../components/EmployerHoursView";

export default function AdminDashboard() {
  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <LogoutButton />
      </div>
      <div className="flex flex-col gap-6">
        <EmployerHoursView />
      </div>
    </div>
  );
}