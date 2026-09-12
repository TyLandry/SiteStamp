import LogoutButton from "../components/LogoutButton";
import ClockInOut from "../components/ClockInClockOut";
import HoursSummary from "../components/HoursSummary";
import TimeOffRequests from "../components/TimeOffRequests";

export default function EmployeeDashboard() {
  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Employee Dashboard</h1>
        <LogoutButton />
      </div>
      <div className="flex flex-col gap-6">
        <ClockInOut />
        <HoursSummary />
        <TimeOffRequests />
      </div>
    </div>
  );
}